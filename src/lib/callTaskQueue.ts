// SDP operations must finish in snapshot order. A failed operation must not
// prevent later snapshots from retrying the answer or delivering candidates.
export function createCallTaskQueue() {
  let tail: Promise<void> = Promise.resolve();
  return (task: () => Promise<void>) => {
    const result = tail.then(task);
    tail = result.catch(() => undefined);
    return result;
  };
}
