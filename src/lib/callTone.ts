type ToneStep = { frequency: number; start: number; duration: number; gain: number };

const OUTGOING_PATTERN: ToneStep[] = [
  { frequency: 440, start: 0, duration: 0.42, gain: 0.045 },
  { frequency: 480, start: 0, duration: 0.42, gain: 0.035 },
];

export type CallToneController = {
  startOutgoing: () => void;
  stop: () => void;
};

export function createCallToneController(): CallToneController {
  let context: AudioContext | null = null;
  let timer: number | undefined;
  let generation = 0;

  const stop = () => {
    generation += 1;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    const current = context;
    context = null;
    if (current) void current.close().catch(() => undefined);
  };

  const playCycle = (cycle: number) => {
    if (!context || cycle !== generation) return;
    const base = context.currentTime + 0.02;
    for (const step of OUTGOING_PATTERN) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(step.frequency, base + step.start);
      gain.gain.setValueAtTime(0.0001, base + step.start);
      gain.gain.exponentialRampToValueAtTime(step.gain, base + step.start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, base + step.start + step.duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(base + step.start);
      oscillator.stop(base + step.start + step.duration + 0.03);
    }
    timer = window.setTimeout(() => playCycle(cycle), 2_800);
  };

  const startOutgoing = () => {
    stop();
    const AudioContextType = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextType) return;
    try {
      generation += 1;
      const cycle = generation;
      context = new AudioContextType();
      void context.resume().then(() => playCycle(cycle)).catch(stop);
    } catch {
      stop();
    }
  };

  return { startOutgoing, stop };
}
