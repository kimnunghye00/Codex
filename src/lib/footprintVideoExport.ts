import { Capacitor, registerPlugin } from '@capacitor/core';
import { getDownloadURL, ref } from 'firebase/storage';
import type { JointRoutePoint } from './footprintFoundation';
import { storage } from './firebaseStorage';
import { chatMediaPreviewUrl } from './chatMediaReference';
import type { FootprintVideoMemoryMoment } from './footprintVideoMemories';
import { buildFootprintVideoPlan, type FootprintVideoPlan } from './footprintVideoPlan';
import {
  protectFootprintVideoRoute,
  type FootprintVideoPrivacyResult,
} from './footprintVideoPrivacy';

export type FootprintVideoOrientation = 'portrait' | 'landscape';

export type FootprintVideoExportOptions = {
  points: readonly JointRoutePoint[];
  orientation: FootprintVideoOrientation;
  title: string;
  subtitle: string;
  durationMinutes: number;
  fileBaseName: string;
  hideSensitiveLocations?: boolean;
  memoryMoments?: readonly FootprintVideoMemoryMoment[];
  onProgress?: (progress: number) => void;
};

export type FootprintVideoExportResult = {
  fileName: string;
  mimeType: string;
  savedTo: 'gallery' | 'download';
  uri?: string;
  privacyProtected: boolean;
  hiddenPointCount: number;
  includedMemoryCount: number;
};

export type FootprintVideoShareResult = FootprintVideoExportResult & {
  shared: boolean;
  shareFallback: boolean;
};

export type PreparedFootprintVideoShare = {
  blob: Blob;
  fileName: string;
  mimeType: string;
  privacyProtected: boolean;
  hiddenPointCount: number;
  includedMemoryCount: number;
};

type RouteMediaSaverPlugin = {
  saveVideo(options: {
    uri: string;
    fileName: string;
    mimeType: string;
  }): Promise<{ saved: boolean; uri: string }>;
  shareVideo(options: {
    uri: string;
    mimeType: string;
    title: string;
  }): Promise<{ shared: boolean }>;
};

const RouteMediaSaver = registerPlugin<RouteMediaSaverPlugin>('RouteMediaSaver');
const INTRO_MS = 900;
const OUTRO_MS = 1_200;
const MEMORY_PHOTO_HOLD_MS = 1_450;
const MEMORY_VIDEO_MAX_MS = 3_000;
const MEMORY_VIDEO_MIN_MS = 1_200;
const MEMORY_MEDIA_MAX = 6;
const MEMORY_MEDIA_LOAD_TIMEOUT_MS = 9_000;

function clamp(min: number, max: number, value: number) {
  return Math.min(max, Math.max(min, value));
}

function distanceText(meters: number) {
  if (!Number.isFinite(meters) || meters <= 0) return '0m';
  if (meters >= 10_000) return Math.round(meters / 1000) + 'km';
  if (meters >= 1000) return (meters / 1000).toFixed(1) + 'km';
  return Math.round(meters) + 'm';
}

function timeText(iso: string) {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '--:--';
  }
}

function readPalette() {
  const root = document.documentElement;
  const styles = window.getComputedStyle(root);
  return {
    primary: styles.getPropertyValue('--primary').trim() || '#3D405B',
    accent: styles.getPropertyValue('--route-accent').trim()
      || styles.getPropertyValue('--primary-light').trim()
      || '#E07A5F',
  };
}

function dimensions(orientation: FootprintVideoOrientation) {
  return orientation === 'portrait'
    ? { width: 720, height: 1280 }
    : { width: 1280, height: 720 };
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function projectedPoints(
  plan: FootprintVideoPlan,
  width: number,
  height: number,
  orientation: FootprintVideoOrientation,
) {
  const meanLatitude = plan.points.reduce((sum, point) => sum + point.latitude, 0) / plan.points.length;
  const longitudeScale = Math.max(0.2, Math.cos(meanLatitude * Math.PI / 180));
  const raw = plan.points.map((point) => ({
    x: point.longitude * longitudeScale,
    y: -point.latitude,
  }));
  const minX = Math.min(...raw.map((point) => point.x));
  const maxX = Math.max(...raw.map((point) => point.x));
  const minY = Math.min(...raw.map((point) => point.y));
  const maxY = Math.max(...raw.map((point) => point.y));
  const horizontalPadding = orientation === 'portrait' ? 86 : 118;
  const topPadding = orientation === 'portrait' ? 230 : 138;
  const bottomPadding = orientation === 'portrait' ? 260 : 160;
  const availableWidth = Math.max(1, width - horizontalPadding * 2);
  const availableHeight = Math.max(1, height - topPadding - bottomPadding);
  const spanX = Math.max(0.000001, maxX - minX);
  const spanY = Math.max(0.000001, maxY - minY);
  const scale = Math.min(availableWidth / spanX, availableHeight / spanY);
  const usedWidth = spanX * scale;
  const usedHeight = spanY * scale;
  const offsetX = horizontalPadding + (availableWidth - usedWidth) / 2;
  const offsetY = topPadding + (availableHeight - usedHeight) / 2;

  return raw.map((point) => ({
    x: offsetX + (point.x - minX) * scale,
    y: offsetY + (point.y - minY) * scale,
  }));
}

function drawBackground(context: CanvasRenderingContext2D, width: number, height: number) {
  context.fillStyle = '#F5F1EB';
  context.fillRect(0, 0, width, height);

  context.save();
  context.globalAlpha = 0.42;
  context.strokeStyle = '#DED8D0';
  context.lineWidth = Math.max(1, width / 900);
  const grid = Math.max(52, Math.round(Math.min(width, height) / 9));
  for (let x = -grid; x < width + grid; x += grid) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + height * 0.2, height);
    context.stroke();
  }
  for (let y = 0; y < height + grid; y += grid) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y - width * 0.08);
    context.stroke();
  }

  context.globalAlpha = 0.6;
  context.strokeStyle = '#E9E3DA';
  context.lineWidth = Math.max(3, width / 280);
  for (let index = 0; index < 4; index += 1) {
    const y = height * (0.23 + index * 0.17);
    context.beginPath();
    context.moveTo(-width * 0.05, y);
    context.bezierCurveTo(
      width * 0.24,
      y - height * 0.09,
      width * 0.64,
      y + height * 0.08,
      width * 1.05,
      y - height * 0.04,
    );
    context.stroke();
  }
  context.restore();
}

function drawPinDuo(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  primary: string,
  accent: string,
  alpha = 1,
) {
  const drawPin = (offsetX: number, color: string, rotate: number) => {
    context.save();
    context.translate(x + offsetX * scale, y);
    context.rotate(rotate);
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.strokeStyle = '#FFFFFF';
    context.lineWidth = 3 * scale;
    context.beginPath();
    context.arc(0, -5 * scale, 12 * scale, 0, Math.PI * 2);
    context.lineTo(0, 18 * scale);
    context.closePath();
    context.fill();
    context.stroke();
    context.fillStyle = '#FFFFFF';
    context.font = '900 ' + Math.round(12 * scale) + 'px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('♡', 0, -5 * scale);
    context.restore();
  };

  context.save();
  context.shadowColor = 'rgba(35,35,45,.24)';
  context.shadowBlur = 12 * scale;
  context.shadowOffsetY = 5 * scale;
  drawPin(-8, primary, -0.12);
  drawPin(8, accent, 0.12);
  context.restore();
}

function drawHeader(
  context: CanvasRenderingContext2D,
  width: number,
  orientation: FootprintVideoOrientation,
  title: string,
  subtitle: string,
) {
  const side = orientation === 'portrait' ? 52 : 66;
  const top = orientation === 'portrait' ? 66 : 48;
  const titleSize = orientation === 'portrait' ? 34 : 31;

  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#3A3944';
  context.font = '800 ' + titleSize + 'px system-ui, sans-serif';
  context.fillText(title, side, top + titleSize);

  context.fillStyle = '#77727B';
  context.font = '700 ' + (orientation === 'portrait' ? 17 : 15) + 'px system-ui, sans-serif';
  context.fillText(subtitle + ' · 두 사람 GPS 교차검증', side, top + titleSize + 30);

  context.textAlign = 'right';
  context.fillStyle = '#3D405B';
  context.font = '900 ' + (orientation === 'portrait' ? 18 : 16) + 'px system-ui, sans-serif';
  context.fillText('단둘이', width - side, top + titleSize);
}

function activePlaybackState(plan: FootprintVideoPlan, elapsedMs: number) {
  if (!plan.segments.length) {
    return {
      segment: undefined,
      ratio: 1,
      pointIndex: Math.max(0, plan.points.length - 1),
      distanceMeters: plan.totalDistanceMeters,
      status: '데이트 재생 완료',
      time: plan.points[plan.points.length - 1]?.arrivedAt || '',
      markerAlpha: 1,
    };
  }

  const clamped = clamp(0, plan.playbackDurationMs, elapsedMs);
  const segment = plan.segments.find((item) => clamped < item.endOffsetMs)
    || plan.segments[plan.segments.length - 1];
  const local = clamp(0, segment.durationMs + segment.holdMs, clamped - segment.startOffsetMs);
  const movementRatio = clamp(0, 1, local / Math.max(1, segment.durationMs));
  const from = plan.points[segment.fromIndex];
  const to = plan.points[segment.toIndex];
  const fromTime = Date.parse(from.arrivedAt);
  const toTime = Date.parse(to.arrivedAt);
  const timeRatio = segment.kind === 'reconnect'
    ? (movementRatio < 0.5 ? 0 : 1)
    : movementRatio;
  const currentTime = new Date(fromTime + (toTime - fromTime) * timeRatio).toISOString();

  if (segment.kind === 'reconnect') {
    const fade = movementRatio < 0.5
      ? 1 - movementRatio * 2
      : (movementRatio - 0.5) * 2;
    return {
      segment,
      ratio: movementRatio < 0.5 ? 0 : 1,
      pointIndex: movementRatio < 0.5 ? segment.fromIndex : segment.toIndex,
      distanceMeters: segment.distanceBeforeMeters,
      status: movementRatio < 0.5 ? '잠깐 떨어진 구간' : '다시 함께한 위치',
      time: currentTime,
      markerAlpha: clamp(0.18, 1, fade),
    };
  }

  return {
    segment,
    ratio: movementRatio,
    pointIndex: segment.fromIndex,
    distanceMeters: segment.distanceBeforeMeters
      + (segment.kind === 'move' ? segment.distanceMeters * movementRatio : 0),
    status: segment.kind === 'stay'
      ? (local > segment.durationMs ? '함께 머문 시간' : '함께 머무는 중')
      : '함께 이동 중',
    time: currentTime,
    markerAlpha: 1,
  };
}

function drawRoute(
  context: CanvasRenderingContext2D,
  plan: FootprintVideoPlan,
  coordinates: { x: number; y: number }[],
  elapsedMs: number,
  primary: string,
  accent: string,
  orientation: FootprintVideoOrientation,
) {
  const active = activePlaybackState(plan, elapsedMs);
  const lineWidth = orientation === 'portrait' ? 8 : 7;

  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';

  for (const segment of plan.segments) {
    if (segment.kind === 'reconnect') continue;
    const from = coordinates[segment.fromIndex];
    const to = coordinates[segment.toIndex];
    if (!from || !to || elapsedMs <= segment.startOffsetMs) continue;

    const completed = elapsedMs >= segment.startOffsetMs + segment.durationMs;
    const partialRatio = completed
      ? 1
      : clamp(0, 1, (elapsedMs - segment.startOffsetMs) / Math.max(1, segment.durationMs));

    const endX = from.x + (to.x - from.x) * partialRatio;
    const endY = from.y + (to.y - from.y) * partialRatio;
    context.globalAlpha = segment.kind === 'stay' ? 0.55 : 0.96;
    context.strokeStyle = accent;
    context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(endX, endY);
    context.stroke();
  }

  context.globalAlpha = 0.85;
  context.fillStyle = '#FFFFFF';
  context.strokeStyle = primary;
  context.lineWidth = 3;
  const pointRadius = orientation === 'portrait' ? 7 : 6;
  for (let index = 0; index < coordinates.length; index += 1) {
    const point = coordinates[index];
    const reached = plan.segments.every((segment) => {
      if (segment.toIndex !== index) return true;
      return elapsedMs >= segment.startOffsetMs + segment.durationMs;
    });
    if (index !== 0 && !reached) continue;
    context.beginPath();
    context.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  let markerX = coordinates[active.pointIndex]?.x ?? coordinates[0].x;
  let markerY = coordinates[active.pointIndex]?.y ?? coordinates[0].y;
  if (active.segment && active.segment.kind !== 'reconnect') {
    const from = coordinates[active.segment.fromIndex];
    const to = coordinates[active.segment.toIndex];
    markerX = from.x + (to.x - from.x) * active.ratio;
    markerY = from.y + (to.y - from.y) * active.ratio;
  }
  drawPinDuo(
    context,
    markerX,
    markerY - (orientation === 'portrait' ? 13 : 10),
    orientation === 'portrait' ? 1.2 : 1,
    primary,
    accent,
    active.markerAlpha,
  );
  context.restore();

  return active;
}

function drawFooter(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  orientation: FootprintVideoOrientation,
  status: string,
  time: string,
  distanceMeters: number,
  placeName?: string,
) {
  const side = orientation === 'portrait' ? 46 : 60;
  const panelHeight = orientation === 'portrait' ? 152 : 112;
  const bottom = orientation === 'portrait' ? 48 : 36;
  const top = height - bottom - panelHeight;

  context.save();
  context.fillStyle = 'rgba(42,42,54,.91)';
  roundedRect(context, side, top, width - side * 2, panelHeight, 26);
  context.fill();

  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#FFFFFF';
  context.font = '800 ' + (orientation === 'portrait' ? 18 : 16) + 'px system-ui, sans-serif';
  context.fillText(status, side + 28, top + 42);

  context.fillStyle = '#FFFFFF';
  context.font = '900 ' + (orientation === 'portrait' ? 30 : 25) + 'px system-ui, sans-serif';
  context.fillText(timeText(time), side + 28, top + (orientation === 'portrait' ? 91 : 82));

  context.textAlign = 'right';
  context.fillStyle = '#F4D7CE';
  context.font = '900 ' + (orientation === 'portrait' ? 24 : 21) + 'px system-ui, sans-serif';
  context.fillText(distanceText(distanceMeters), width - side - 28, top + (orientation === 'portrait' ? 91 : 82));

  if (orientation === 'portrait' && placeName) {
    context.textAlign = 'left';
    context.fillStyle = '#FFFFFFB8';
    context.font = '700 14px system-ui, sans-serif';
    const safeName = placeName.length > 28 ? placeName.slice(0, 27) + '…' : placeName;
    context.fillText(safeName, side + 28, top + 124);
  }
  context.restore();
}

function drawIntro(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  title: string,
  progress: number,
) {
  const alpha = 1 - clamp(0, 1, progress);
  if (alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha * 0.86;
  context.fillStyle = '#F5F1EB';
  context.fillRect(0, 0, width, height);
  context.globalAlpha = alpha;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#3A3944';
  context.font = '900 ' + Math.round(Math.min(width, height) * 0.055) + 'px system-ui, sans-serif';
  context.fillText(title, width / 2, height / 2 - 26);
  context.fillStyle = '#77727B';
  context.font = '700 ' + Math.round(Math.min(width, height) * 0.025) + 'px system-ui, sans-serif';
  context.fillText('둘이 함께 확인된 하루를 다시 걸어봐요', width / 2, height / 2 + 32);
  context.restore();
}

function drawOutro(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  orientation: FootprintVideoOrientation,
  plan: FootprintVideoPlan,
  durationMinutes: number,
  progress: number,
) {
  const alpha = clamp(0, 1, progress);
  if (alpha <= 0) return;
  const cardWidth = orientation === 'portrait' ? width - 110 : Math.min(610, width - 160);
  const cardHeight = orientation === 'portrait' ? 260 : 215;
  const x = (width - cardWidth) / 2;
  const y = (height - cardHeight) / 2;

  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = 'rgba(42,42,54,.94)';
  roundedRect(context, x, y, cardWidth, cardHeight, 30);
  context.fill();

  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#FFFFFF';
  context.font = '900 ' + (orientation === 'portrait' ? 28 : 25) + 'px system-ui, sans-serif';
  context.fillText('오늘도 둘이 함께 ♡', width / 2, y + 62);

  context.fillStyle = '#F4D7CE';
  context.font = '900 ' + (orientation === 'portrait' ? 42 : 36) + 'px system-ui, sans-serif';
  context.fillText(distanceText(plan.totalDistanceMeters), width / 2, y + 125);

  context.fillStyle = '#FFFFFFCC';
  context.font = '700 ' + (orientation === 'portrait' ? 17 : 15) + 'px system-ui, sans-serif';
  context.fillText(
    '함께 확인된 시간 약 ' + Math.max(1, durationMinutes) + '분 · GPS 검증 ' + plan.points.length + '개',
    width / 2,
    y + 169,
  );

  if (plan.reconnectCount > 0) {
    context.fillStyle = '#FFFFFF9C';
    context.font = '700 ' + (orientation === 'portrait' ? 14 : 13) + 'px system-ui, sans-serif';
    context.fillText('재연결 구간 ' + plan.reconnectCount + '회는 이동선에서 제외했어요', width / 2, y + 207);
  }
  context.restore();
}

type LoadedMemoryMedia = {
  id: string;
  pointId: string;
  kind: 'photo' | 'video';
  media: CanvasImageSource;
  video?: HTMLVideoElement;
  width: number;
  height: number;
  durationMs: number;
  placeName: string;
  memoryTitle: string;
  cleanup: () => void;
};

type MemoryPresentationFrame = LoadedMemoryMedia & {
  routeOffsetMs: number;
  presentationStartMs: number;
  presentationEndMs: number;
};

async function resolveMemoryMediaUrl(source: string) {
  const preview = chatMediaPreviewUrl(source);
  if (!preview.startsWith('gs://')) return preview;
  return getDownloadURL(ref(storage, preview));
}

async function fetchMemoryMediaBlob(source: string) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = controller
    ? window.setTimeout(() => controller.abort(), MEMORY_MEDIA_LOAD_TIMEOUT_MS)
    : undefined;
  try {
    const response = await fetch(source, {
      signal: controller?.signal,
      credentials: 'omit',
      cache: 'force-cache',
    });
    if (!response.ok) return undefined;
    return await response.blob();
  } catch {
    return undefined;
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

async function loadMemoryPhoto(
  moment: FootprintVideoMemoryMoment,
  source: string,
): Promise<LoadedMemoryMedia | undefined> {
  const blob = await fetchMemoryMediaBlob(source);
  if (!blob || (blob.type && !blob.type.startsWith('image/'))) return undefined;

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        id: moment.id,
        pointId: moment.pointId,
        kind: 'photo',
        media: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        durationMs: MEMORY_PHOTO_HOLD_MS,
        placeName: moment.placeName,
        memoryTitle: moment.memoryTitle,
        cleanup: () => bitmap.close(),
      };
    } catch {
      return undefined;
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('VIDEO_MEMORY_IMAGE_LOAD_FAILED'));
      element.src = objectUrl;
    });
    return {
      id: moment.id,
      pointId: moment.pointId,
      kind: 'photo',
      media: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      durationMs: MEMORY_PHOTO_HOLD_MS,
      placeName: moment.placeName,
      memoryTitle: moment.memoryTitle,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    };
  } catch {
    URL.revokeObjectURL(objectUrl);
    return undefined;
  }
}

async function loadMemoryVideo(
  moment: FootprintVideoMemoryMoment,
  source: string,
): Promise<LoadedMemoryMedia | undefined> {
  const blob = await fetchMemoryMediaBlob(source);
  if (!blob) return undefined;
  const objectUrl = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.src = objectUrl;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('VIDEO_MEMORY_CLIP_TIMEOUT')), MEMORY_MEDIA_LOAD_TIMEOUT_MS);
      const done = () => {
        window.clearTimeout(timer);
        video.removeEventListener('loadeddata', done);
        video.removeEventListener('error', fail);
        resolve();
      };
      const fail = () => {
        window.clearTimeout(timer);
        video.removeEventListener('loadeddata', done);
        video.removeEventListener('error', fail);
        reject(new Error('VIDEO_MEMORY_CLIP_LOAD_FAILED'));
      };
      video.addEventListener('loadeddata', done, { once: true });
      video.addEventListener('error', fail, { once: true });
      video.load();
    });

    const durationSeconds = Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : MEMORY_VIDEO_MAX_MS / 1000;
    const durationMs = Math.round(clamp(
      MEMORY_VIDEO_MIN_MS,
      MEMORY_VIDEO_MAX_MS,
      durationSeconds * 1000,
    ));
    video.currentTime = 0;
    return {
      id: moment.id,
      pointId: moment.pointId,
      kind: 'video',
      media: video,
      video,
      width: video.videoWidth || 1280,
      height: video.videoHeight || 720,
      durationMs,
      placeName: moment.placeName,
      memoryTitle: moment.memoryTitle,
      cleanup: () => {
        video.pause();
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(objectUrl);
      },
    };
  } catch {
    video.pause();
    video.removeAttribute('src');
    URL.revokeObjectURL(objectUrl);
    return undefined;
  }
}

async function loadMemoryMedia(moment: FootprintVideoMemoryMoment) {
  const source = await resolveMemoryMediaUrl(moment.mediaUrl).catch(() => '');
  if (!source) return undefined;
  return moment.kind === 'video'
    ? loadMemoryVideo(moment, source)
    : loadMemoryPhoto(moment, source);
}

async function loadMemoryMediaMoments(
  moments: readonly FootprintVideoMemoryMoment[] | undefined,
  allowedPointIds: ReadonlySet<string>,
) {
  const selected = [...(moments ?? [])]
    .filter((moment) => allowedPointIds.has(moment.pointId))
    .slice(0, MEMORY_MEDIA_MAX);
  const loaded = await Promise.all(selected.map((moment) => loadMemoryMedia(moment)));
  return loaded.filter((media): media is LoadedMemoryMedia => Boolean(media));
}

function routeOffsetForPoint(plan: FootprintVideoPlan, pointId: string) {
  const pointIndex = plan.points.findIndex((point) => point.id === pointId);
  if (pointIndex <= 0) return 0;
  const segment = plan.segments.find((item) => item.toIndex === pointIndex);
  if (segment) return segment.startOffsetMs + segment.durationMs;
  return Math.round(plan.playbackDurationMs * (pointIndex / Math.max(1, plan.points.length - 1)));
}

function buildMemoryPresentationFrames(plan: FootprintVideoPlan, media: readonly LoadedMemoryMedia[]) {
  let insertedMs = 0;
  return [...media]
    .map((item) => ({ item, routeOffsetMs: routeOffsetForPoint(plan, item.pointId) }))
    .sort((a, b) => a.routeOffsetMs - b.routeOffsetMs || a.item.id.localeCompare(b.item.id))
    .map(({ item, routeOffsetMs }) => {
      const presentationStartMs = routeOffsetMs + insertedMs;
      const presentationEndMs = presentationStartMs + item.durationMs;
      insertedMs += item.durationMs;
      return { ...item, routeOffsetMs, presentationStartMs, presentationEndMs };
    });
}

function presentationState(
  presentationElapsedMs: number,
  frames: readonly MemoryPresentationFrame[],
  routeDurationMs: number,
) {
  let insertedMs = 0;
  for (const frame of frames) {
    if (presentationElapsedMs < frame.presentationStartMs) {
      return {
        routeElapsedMs: clamp(0, routeDurationMs, presentationElapsedMs - insertedMs),
        frame: undefined as MemoryPresentationFrame | undefined,
        frameProgress: 0,
      };
    }
    if (presentationElapsedMs < frame.presentationEndMs) {
      return {
        routeElapsedMs: clamp(0, routeDurationMs, frame.routeOffsetMs),
        frame,
        frameProgress: clamp(
          0,
          1,
          (presentationElapsedMs - frame.presentationStartMs) / Math.max(1, frame.durationMs),
        ),
      };
    }
    insertedMs += frame.durationMs;
  }
  return {
    routeElapsedMs: clamp(0, routeDurationMs, presentationElapsedMs - insertedMs),
    frame: undefined as MemoryPresentationFrame | undefined,
    frameProgress: 0,
  };
}

function drawMemoryMedia(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  orientation: FootprintVideoOrientation,
  frame: MemoryPresentationFrame,
  progress: number,
) {
  const edgeFade = 0.16;
  const alpha = progress < edgeFade
    ? progress / edgeFade
    : progress > 1 - edgeFade
      ? (1 - progress) / edgeFade
      : 1;
  const settle = 0.975 + Math.min(0.025, progress * 0.05);
  const baseWidth = orientation === 'portrait' ? width * 0.76 : width * 0.48;
  const baseHeight = orientation === 'portrait' ? height * 0.52 : height * 0.64;
  const cardWidth = baseWidth * settle;
  const cardHeight = baseHeight * settle;
  const x = (width - cardWidth) / 2;
  const y = (height - cardHeight) / 2 - (orientation === 'portrait' ? 4 : 0);
  const sourceRatio = frame.width / Math.max(1, frame.height);
  const targetRatio = cardWidth / cardHeight;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = frame.width;
  let sourceHeight = frame.height;
  if (sourceRatio > targetRatio) {
    sourceWidth = frame.height * targetRatio;
    sourceX = (frame.width - sourceWidth) / 2;
  } else {
    sourceHeight = frame.width / targetRatio;
    sourceY = (frame.height - sourceHeight) / 2;
  }

  context.save();
  context.globalAlpha = clamp(0, 1, alpha);
  context.fillStyle = 'rgba(30,30,39,.62)';
  context.fillRect(0, 0, width, height);

  const badgeText = (frame.placeName || '함께 있었던 장소') + ' · 도착';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '900 ' + (orientation === 'portrait' ? 24 : 21) + 'px system-ui, sans-serif';
  const badgeWidth = Math.min(width - 80, Math.max(190, context.measureText(badgeText).width + 48));
  const badgeHeight = orientation === 'portrait' ? 52 : 46;
  const badgeX = (width - badgeWidth) / 2;
  const badgeY = Math.max(orientation === 'portrait' ? 120 : 54, y - badgeHeight - 28);
  context.fillStyle = 'rgba(42,42,54,.92)';
  roundedRect(context, badgeX, badgeY, badgeWidth, badgeHeight, badgeHeight / 2);
  context.fill();
  context.fillStyle = '#FFFFFF';
  context.fillText(badgeText.length > 30 ? badgeText.slice(0, 29) + '…' : badgeText, width / 2, badgeY + badgeHeight / 2 + 1);

  context.shadowColor = 'rgba(20,20,30,.34)';
  context.shadowBlur = orientation === 'portrait' ? 34 : 26;
  context.shadowOffsetY = 12;
  context.fillStyle = '#FFFFFF';
  roundedRect(context, x - 12, y - 12, cardWidth + 24, cardHeight + 64, 28);
  context.fill();

  context.shadowColor = 'transparent';
  context.save();
  roundedRect(context, x, y, cardWidth, cardHeight, 20);
  context.clip();
  context.drawImage(
    frame.media,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    cardWidth,
    cardHeight,
  );
  context.restore();

  if (frame.kind === 'video') {
    const pillWidth = orientation === 'portrait' ? 96 : 86;
    const pillHeight = orientation === 'portrait' ? 34 : 30;
    context.fillStyle = 'rgba(20,20,28,.72)';
    roundedRect(context, x + 16, y + 16, pillWidth, pillHeight, pillHeight / 2);
    context.fill();
    context.fillStyle = '#FFFFFF';
    context.font = '800 ' + (orientation === 'portrait' ? 13 : 12) + 'px system-ui, sans-serif';
    context.fillText('▶ 짧은 영상', x + 16 + pillWidth / 2, y + 16 + pillHeight / 2 + 1);
  }

  context.fillStyle = '#3A3944';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '800 ' + (orientation === 'portrait' ? 18 : 16) + 'px system-ui, sans-serif';
  const caption = frame.memoryTitle || '그날의 추억 ♡';
  context.fillText(caption.length > 28 ? caption.slice(0, 27) + '…' : caption, width / 2, y + cardHeight + 31);
  context.restore();
}

function chooseVideoMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || '';
}

async function recordCanvasVideo(
  options: FootprintVideoExportOptions,
): Promise<{
  blob: Blob;
  mimeType: string;
  privacy: FootprintVideoPrivacyResult;
  includedMemoryCount: number;
}> {
  if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') {
    throw new Error('VIDEO_RECORDING_UNSUPPORTED');
  }
  const privacy = protectFootprintVideoRoute(
    options.points,
    options.hideSensitiveLocations !== false,
  );
  const plan = buildFootprintVideoPlan(privacy.points);
  if (plan.points.length < 2 || !plan.segments.length) {
    throw new Error('VIDEO_ROUTE_TOO_SHORT');
  }
  const allowedPointIds = new Set(plan.points.map((point) => point.id));
  const loadedMemoryMedia = await loadMemoryMediaMoments(options.memoryMoments, allowedPointIds);
  const memoryFrames = buildMemoryPresentationFrames(plan, loadedMemoryMedia);

  const { width, height } = dimensions(options.orientation);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context || typeof canvas.captureStream !== 'function') {
    throw new Error('VIDEO_CANVAS_UNSUPPORTED');
  }

  const mimeType = chooseVideoMimeType();
  if (!mimeType) throw new Error('VIDEO_FORMAT_UNSUPPORTED');

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: options.orientation === 'portrait' ? 4_800_000 : 5_200_000,
  });
  const chunks: BlobPart[] = [];
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => reject(new Error('VIDEO_RECORDING_FAILED'));
    recorder.onstop = () => resolve();
  });

  const palette = readPalette();
  const coordinates = projectedPoints(plan, width, height, options.orientation);
  const presentationDurationMs = plan.playbackDurationMs
    + memoryFrames.reduce((sum, frame) => sum + frame.durationMs, 0);
  const totalMs = INTRO_MS + presentationDurationMs + OUTRO_MS;
  let lastProgress = -1;
  let activeVideoId = '';

  recorder.start(500);
  const startedAt = performance.now();

  await new Promise<void>((resolve) => {
    const render = (now: number) => {
      const elapsed = clamp(0, totalMs, now - startedAt);
      const presentationElapsed = clamp(0, presentationDurationMs, elapsed - INTRO_MS);
      const memoryState = presentationState(
        presentationElapsed,
        memoryFrames,
        plan.playbackDurationMs,
      );
      const routeElapsed = memoryState.routeElapsedMs;
      drawBackground(context, width, height);
      drawHeader(context, width, options.orientation, options.title, options.subtitle);
      const active = drawRoute(
        context,
        plan,
        coordinates,
        routeElapsed,
        palette.primary,
        palette.accent,
        options.orientation,
      );
      const activePoint = active.segment
        ? plan.points[active.ratio >= 0.999 ? active.segment.toIndex : active.segment.fromIndex]
        : plan.points[plan.points.length - 1];
      drawFooter(
        context,
        width,
        height,
        options.orientation,
        active.status,
        active.time,
        active.distanceMeters,
        activePoint?.placeName,
      );
      if (memoryState.frame) {
        if (memoryState.frame.kind === 'video' && memoryState.frame.video) {
          if (activeVideoId !== memoryState.frame.id) {
            loadedMemoryMedia.forEach((item) => {
              if (item.video && item.id !== memoryState.frame?.id) item.video.pause();
            });
            activeVideoId = memoryState.frame.id;
            try { memoryState.frame.video.currentTime = 0; } catch { /* keep the decoded frame */ }
            void memoryState.frame.video.play().catch(() => undefined);
          }
        } else if (activeVideoId) {
          loadedMemoryMedia.forEach((item) => item.video?.pause());
          activeVideoId = '';
        }
        drawMemoryMedia(
          context,
          width,
          height,
          options.orientation,
          memoryState.frame,
          memoryState.frameProgress,
        );
      } else if (activeVideoId) {
        loadedMemoryMedia.forEach((item) => item.video?.pause());
        activeVideoId = '';
      }

      if (elapsed < INTRO_MS) drawIntro(context, width, height, options.title, elapsed / INTRO_MS);
      if (elapsed > INTRO_MS + presentationDurationMs) {
        drawOutro(
          context,
          width,
          height,
          options.orientation,
          plan,
          options.durationMinutes,
          (elapsed - INTRO_MS - presentationDurationMs) / OUTRO_MS,
        );
      }

      const progress = Math.round((elapsed / totalMs) * 100);
      if (progress !== lastProgress) {
        lastProgress = progress;
        options.onProgress?.(progress / 100);
      }

      if (elapsed >= totalMs) {
        resolve();
        return;
      }
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  });

  await new Promise((resolve) => window.setTimeout(resolve, 100));
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());
  const blob = new Blob(chunks, { type: mimeType });
  loadedMemoryMedia.forEach((item) => item.cleanup());
  if (!blob.size) throw new Error('VIDEO_RECORDING_EMPTY');
  return { blob, mimeType, privacy, includedMemoryCount: memoryFrames.length };
}

function extensionFor(mimeType: string) {
  return mimeType.includes('mp4') ? 'mp4' : 'webm';
}

function safeFileBaseName(value: string) {
  const normalized = value.normalize('NFC').replace(/[^0-9A-Za-z가-힣._-]+/g, '-').replace(/-+/g, '-');
  return normalized.replace(/^-|-$/g, '').slice(0, 80) || 'DANDULI-footprint';
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('VIDEO_FILE_READ_FAILED'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

async function saveAndroidVideo(blob: Blob, fileName: string, mimeType: string) {
  if (Capacitor.getPlatform() !== 'android') return undefined;
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const temporaryPath = 'danduli-video/' + fileName;
  const data = await blobToBase64(blob);
  const temporary = await Filesystem.writeFile({
    path: temporaryPath,
    data,
    directory: Directory.Cache,
    recursive: true,
  });

  try {
    const result = await RouteMediaSaver.saveVideo({
      uri: temporary.uri,
      fileName,
      mimeType,
    });
    if (!result.saved) throw new Error('VIDEO_NATIVE_SAVE_FAILED');
    return result.uri;
  } finally {
    await Filesystem.deleteFile({
      path: temporaryPath,
      directory: Directory.Cache,
    }).catch(() => undefined);
  }
}

function downloadWebVideo(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2_000);
}

function privacyFields(privacy: FootprintVideoPrivacyResult) {
  return {
    privacyProtected: privacy.enabled,
    hiddenPointCount: privacy.hiddenPointCount,
  };
}

async function shareWebVideo(blob: Blob, fileName: string, mimeType: string, title: string) {
  if (typeof navigator.share !== 'function') return false;
  const file = new File([blob], fileName, { type: mimeType });
  if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({
      title,
      text: '단둘이에서 만든 우리 데이트 발자취 영상이에요.',
      files: [file],
    });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('VIDEO_SHARE_CANCELLED', { cause: error });
    }
    if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
      return false;
    }
    throw error;
  }
}

export async function exportFootprintVideo(
  options: FootprintVideoExportOptions,
): Promise<FootprintVideoExportResult> {
  const { blob, mimeType, privacy, includedMemoryCount } = await recordCanvasVideo(options);
  const extension = extensionFor(mimeType);
  const fileName = safeFileBaseName(options.fileBaseName) + '.' + extension;

  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    const uri = await saveAndroidVideo(blob, fileName, mimeType);
    if (!uri) throw new Error('VIDEO_NATIVE_SAVE_FAILED');
    return { fileName, mimeType, savedTo: 'gallery', uri, includedMemoryCount, ...privacyFields(privacy) };
  }

  downloadWebVideo(blob, fileName);
  return { fileName, mimeType, savedTo: 'download', includedMemoryCount, ...privacyFields(privacy) };
}

export async function prepareFootprintVideoShare(
  options: FootprintVideoExportOptions,
): Promise<PreparedFootprintVideoShare> {
  const { blob, mimeType, privacy, includedMemoryCount } = await recordCanvasVideo(options);
  const extension = extensionFor(mimeType);
  return {
    blob,
    mimeType,
    fileName: safeFileBaseName(options.fileBaseName) + '.' + extension,
    includedMemoryCount,
    ...privacyFields(privacy),
  };
}

export async function sharePreparedFootprintVideo(
  prepared: PreparedFootprintVideoShare,
  title: string,
): Promise<FootprintVideoShareResult> {
  const shared = await shareWebVideo(prepared.blob, prepared.fileName, prepared.mimeType, title);
  if (shared) {
    return {
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      savedTo: 'download',
      shared: true,
      shareFallback: false,
      privacyProtected: prepared.privacyProtected,
      hiddenPointCount: prepared.hiddenPointCount,
      includedMemoryCount: prepared.includedMemoryCount,
    };
  }

  downloadWebVideo(prepared.blob, prepared.fileName);
  return {
    fileName: prepared.fileName,
    mimeType: prepared.mimeType,
    savedTo: 'download',
    shared: false,
    shareFallback: true,
    privacyProtected: prepared.privacyProtected,
    hiddenPointCount: prepared.hiddenPointCount,
    includedMemoryCount: prepared.includedMemoryCount,
  };
}

export async function shareFootprintVideo(
  options: FootprintVideoExportOptions,
): Promise<FootprintVideoShareResult> {
  const prepared = await prepareFootprintVideoShare(options);
  const title = options.title || '단둘이 발자취';

  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    const uri = await saveAndroidVideo(prepared.blob, prepared.fileName, prepared.mimeType);
    if (!uri) throw new Error('VIDEO_NATIVE_SAVE_FAILED');
    const result = await RouteMediaSaver.shareVideo({
      uri,
      mimeType: prepared.mimeType,
      title,
    });
    return {
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      savedTo: 'gallery',
      uri,
      shared: result.shared,
      shareFallback: false,
      privacyProtected: prepared.privacyProtected,
      hiddenPointCount: prepared.hiddenPointCount,
      includedMemoryCount: prepared.includedMemoryCount,
    };
  }

  // Web Share requires a fresh transient user gesture. Callers should prepare
  // first, then invoke sharePreparedFootprintVideo from a second explicit click.
  downloadWebVideo(prepared.blob, prepared.fileName);
  return {
    fileName: prepared.fileName,
    mimeType: prepared.mimeType,
    savedTo: 'download',
    shared: false,
    shareFallback: true,
    privacyProtected: prepared.privacyProtected,
    hiddenPointCount: prepared.hiddenPointCount,
    includedMemoryCount: prepared.includedMemoryCount,
  };
}
