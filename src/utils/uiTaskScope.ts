type Scheduler = {
  setTimer: (callback: () => void, delay: number) => number;
  clearTimer: (id: number) => void;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
};

// Own delayed DOM work so a closed/replaced screen can cancel it as one unit.
export function createUiTaskScope(scheduler: Scheduler = {
  setTimer: (callback, delay) => window.setTimeout(callback, delay),
  clearTimer: (id) => window.clearTimeout(id),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
}) {
  let generation = 0;
  const timers = new Set<number>();
  const frames = new Set<number>();
  return {
    delay(callback: () => void, ms: number) {
      const current = generation;
      const id = scheduler.setTimer(() => {
        timers.delete(id);
        if (generation === current) callback();
      }, ms);
      timers.add(id);
    },
    frame(callback: () => void) {
      const current = generation;
      const id = scheduler.requestFrame(() => {
        frames.delete(id);
        if (generation === current) callback();
      });
      frames.add(id);
    },
    clear() {
      generation += 1;
      timers.forEach((id) => scheduler.clearTimer(id));
      frames.forEach((id) => scheduler.cancelFrame(id));
      timers.clear();
      frames.clear();
    },
  };
}
