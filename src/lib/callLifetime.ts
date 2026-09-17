// A call ID alone is insufficient: the same incoming ID can be accepted again
// after cancellation while an earlier permission request is still outstanding.
export function createCallLifetime() {
  let generation = 0;
  let active = false;
  const capture = () => {
    const current = generation;
    return () => active && generation === current;
  };
  return {
    begin() { generation += 1; active = true; return capture(); },
    capture,
    end() { generation += 1; active = false; },
  };
}

function ensureCurrent(isCurrent: () => boolean) {
  if (isCurrent()) return;
  const error = new Error('call-cancelled');
  error.name = 'AbortError';
  throw error;
}

export async function waitForCurrentCall<T>(isCurrent: () => boolean, task: () => Promise<T>): Promise<T> {
  ensureCurrent(isCurrent);
  const value = await task();
  ensureCurrent(isCurrent);
  return value;
}

export async function acquireCallStream<T extends { getTracks(): Array<{ stop(): void }> }>(
  isCurrent: () => boolean,
  task: () => Promise<T>,
): Promise<T> {
  ensureCurrent(isCurrent);
  const stream = await task();
  if (!isCurrent()) stream.getTracks().forEach((track) => track.stop());
  ensureCurrent(isCurrent);
  return stream;
}
