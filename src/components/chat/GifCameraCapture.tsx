import { Camera, Check, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './GifCameraCapture.css';

const MAX_DURATION_MS = 10_000;
const FRAME_INTERVAL_MS = 200;
const MAX_FRAME_EDGE = 288;

type CapturedFrame = { rgba: Uint8ClampedArray; width: number; height: number };

function cameraErrorMessage(cause: unknown) {
  const name = cause instanceof DOMException ? cause.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '카메라 권한을 허용해 주세요.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return '사용할 수 있는 카메라를 찾지 못했어요.';
  if (name === 'NotReadableError') return '카메라를 다른 앱이 사용 중이에요.';
  return '카메라를 열지 못했어요. 잠시 후 다시 시도해 주세요.';
}

function frameSize(video: HTMLVideoElement) {
  const sourceWidth = video.videoWidth || 720;
  const sourceHeight = video.videoHeight || 1280;
  const scale = Math.min(1, MAX_FRAME_EDGE / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(2, Math.round(sourceWidth * scale / 2) * 2),
    height: Math.max(2, Math.round(sourceHeight * scale / 2) * 2),
  };
}

async function encodeGif(frames: CapturedFrame[]) {
  const { GIFEncoder, applyPalette, quantize } = await import('gifenc');
  const encoder = GIFEncoder();
  frames.forEach((frame) => {
    const palette = quantize(frame.rgba, 64, { format: 'rgb444' });
    const indexed = applyPalette(frame.rgba, palette, 'rgb444');
    encoder.writeFrame(indexed, frame.width, frame.height, {
      palette,
      delay: FRAME_INTERVAL_MS,
      repeat: 0,
    });
  });
  encoder.finish();
  return new Blob([Uint8Array.from(encoder.bytes()).buffer], { type: 'image/gif' });
}

export function GifCameraCapture({ onClose, onCaptured, onError }: {
  onClose: () => void;
  onCaptured: (file: File) => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const framesRef = useRef<CapturedFrame[]>([]);
  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const recordingRef = useRef(false);
  const previewUrlRef = useRef('');
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [encoding, setEncoding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState('');
  const [capturedFile, setCapturedFile] = useState<File>();
  const [error, setError] = useState('');

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const clearCaptureTimers = useCallback(() => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    if (animationRef.current !== null) window.cancelAnimationFrame(animationRef.current);
    intervalRef.current = null;
    timeoutRef.current = null;
    animationRef.current = null;
  }, []);

  const resetCapture = useCallback(() => {
    clearCaptureTimers();
    recordingRef.current = false;
    framesRef.current = [];
    setRecording(false);
    setEncoding(false);
    setProgress(0);
    setCapturedFile(undefined);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      previewUrlRef.current = '';
      return '';
    });
  }, [clearCaptureTimers]);

  useEffect(() => {
    let disposed = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('이 기기에서는 카메라 촬영을 지원하지 않아요.');
      return;
    }
    void navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 } },
      audio: false,
    }).then(async (stream) => {
      if (disposed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (!disposed) setReady(true);
    }).catch((cause) => {
      if (!disposed) setError(cameraErrorMessage(cause));
    });
    return () => {
      disposed = true;
      clearCaptureTimers();
      stopCamera();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, [clearCaptureTimers, stopCamera]);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const { width, height } = frameSize(video);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;
    context.translate(width, 0);
    context.scale(-1, 1);
    context.drawImage(video, 0, 0, width, height);
    framesRef.current.push({ rgba: context.getImageData(0, 0, width, height).data, width, height });
  }, []);

  const finishRecording = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    clearCaptureTimers();
    captureFrame();
    setRecording(false);
    setEncoding(true);
    setProgress(Math.min(1, (Date.now() - startedAtRef.current) / MAX_DURATION_MS));
    try {
      const frames = framesRef.current;
      if (!frames.length) throw new Error('empty-capture');
      const blob = await encodeGif(frames);
      if (!blob.size) throw new Error('empty-gif');
      const file = new File([blob], `camera-gif-${Date.now()}.gif`, { type: 'image/gif' });
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setCapturedFile(file);
      setPreviewUrl(url);
      stopCamera();
    } catch {
      setError('움짤을 만들지 못했어요. 다시 촬영해 주세요.');
      framesRef.current = [];
    } finally {
      setEncoding(false);
    }
  }, [captureFrame, clearCaptureTimers, stopCamera]);

  const beginRecording = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!ready || recordingRef.current || encoding || capturedFile) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    framesRef.current = [];
    recordingRef.current = true;
    startedAtRef.current = Date.now();
    setProgress(0);
    setError('');
    setRecording(true);
    captureFrame();
    intervalRef.current = window.setInterval(captureFrame, FRAME_INTERVAL_MS);
    timeoutRef.current = window.setTimeout(() => void finishRecording(), MAX_DURATION_MS);
    const updateProgress = () => {
      if (!recordingRef.current) return;
      setProgress(Math.min(1, (Date.now() - startedAtRef.current) / MAX_DURATION_MS));
      animationRef.current = window.requestAnimationFrame(updateProgress);
    };
    animationRef.current = window.requestAnimationFrame(updateProgress);
  }, [captureFrame, capturedFile, encoding, finishRecording, ready]);

  const close = () => {
    resetCapture();
    stopCamera();
    onClose();
  };

  const send = async () => {
    if (!capturedFile || encoding) return;
    setEncoding(true);
    try {
      await Promise.resolve(onCaptured(capturedFile));
      close();
    } catch {
      setEncoding(false);
      onError('촬영한 움짤을 전송하지 못했어요. 다시 시도해 주세요.');
    }
  };

  const retry = () => {
    resetCapture();
    setReady(false);
    setError('카메라를 다시 여는 중이에요…');
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }).then(async (stream) => {
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setError('');
      setReady(true);
    }).catch((cause) => setError(cameraErrorMessage(cause)));
  };

  if (typeof document === 'undefined') return null;
  const radius = 39;
  const circumference = 2 * Math.PI * radius;

  return createPortal(<div className="gif-camera-backdrop" role="dialog" aria-modal="true" aria-label="카메라 움짤 촬영">
    <section className="gif-camera-sheet">
      <header><div><small>CAMERA GIF</small><h2>움짤 촬영</h2></div><button type="button" onClick={close} aria-label="촬영 닫기"><X /></button></header>
      <div className="gif-camera-stage">
        {previewUrl ? <img src={previewUrl} alt="촬영한 움짤 미리보기" /> : <video ref={videoRef} autoPlay muted playsInline />}
        {!ready && !previewUrl && !error && <div className="gif-camera-status"><Camera /><span>카메라를 여는 중이에요…</span></div>}
        {error && !previewUrl && <div className="gif-camera-status error"><Camera /><span>{error}</span></div>}
        {recording && <span className="gif-camera-live">REC · {(progress * 10).toFixed(1)}초</span>}
        {encoding && !previewUrl && <div className="gif-camera-status"><span className="gif-camera-spinner" /><span>움짤로 만드는 중이에요…</span></div>}
      </div>
      <p className="gif-camera-guide">촬영 버튼을 누르고 있는 동안 촬영돼요 · 최대 10초</p>
      <div className="gif-camera-controls">
        {previewUrl ? <>
          <button type="button" className="gif-camera-secondary" onClick={retry} disabled={encoding}><RefreshCw /><span>다시 촬영</span></button>
          <button type="button" className="gif-camera-send" onClick={() => void send()} disabled={encoding}><Check /><span>{encoding ? '전송 중' : '보내기'}</span></button>
        </> : <button
          type="button"
          className={`gif-camera-record ${recording ? 'recording' : ''}`}
          disabled={!ready || encoding}
          onPointerDown={beginRecording}
          onPointerUp={() => void finishRecording()}
          onPointerCancel={() => void finishRecording()}
          onLostPointerCapture={() => void finishRecording()}
          aria-label="누르고 있는 동안 움짤 촬영"
        >
          <svg viewBox="0 0 88 88" aria-hidden="true"><circle className="track" cx="44" cy="44" r={radius} /><circle className="progress" cx="44" cy="44" r={radius} style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - progress) }} /></svg>
          <span />
        </button>}
      </div>
    </section>
  </div>, document.body);
}
