let audioContext: AudioContext | null = null;
let ringTimer: number | undefined;
let activeNodes: Array<OscillatorNode | GainNode> = [];
let generation = 0;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioContextCtor = window.AudioContext;
  if (!AudioContextCtor) return null;
  if (!audioContext || audioContext.state === 'closed') audioContext = new AudioContextCtor();
  return audioContext;
}

function clearNodes() {
  activeNodes.forEach((node) => {
    try {
      if (node instanceof OscillatorNode) node.stop();
      node.disconnect();
    } catch {
      // Already stopped/disconnected.
    }
  });
  activeNodes = [];
}

function playRingPulse(context: AudioContext, token: number) {
  if (token !== generation) return;

  clearNodes();
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.075, context.currentTime + 0.04);
  gain.gain.setValueAtTime(0.075, context.currentTime + 0.72);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.86);
  gain.connect(context.destination);

  const low = context.createOscillator();
  const high = context.createOscillator();
  low.type = 'sine';
  high.type = 'sine';
  low.frequency.value = 440;
  high.frequency.value = 480;
  low.connect(gain);
  high.connect(gain);
  low.start();
  high.start();
  low.stop(context.currentTime + 0.9);
  high.stop(context.currentTime + 0.9);
  activeNodes = [low, high, gain];
}

export async function startOutgoingRingback() {
  stopOutgoingRingback();
  const context = getAudioContext();
  if (!context) return;

  try {
    if (context.state === 'suspended') await context.resume();
  } catch {
    return;
  }

  const token = ++generation;
  playRingPulse(context, token);
  ringTimer = window.setInterval(() => playRingPulse(context, token), 3000);
}

export function stopOutgoingRingback() {
  generation += 1;
  if (ringTimer !== undefined) {
    window.clearInterval(ringTimer);
    ringTimer = undefined;
  }
  clearNodes();
}
