type BackupState = Record<string, string>;
type BackupSession = {
  uid: string;
  revision: number;
  dirty: boolean;
  lastSaved: string;
  failures: number;
  inflight: Promise<void> | null;
};

export function createBackupCoordinator(options: {
  currentUid: () => string;
  read: (uid: string) => BackupState;
  save: (uid: string, value: BackupState) => Promise<void>;
  onSuccess: () => void;
  onError: (error: unknown) => void;
  schedule: (delay: number) => void;
}) {
  let session: BackupSession | null = null;
  const isCurrent = (state: BackupSession) => session === state && options.currentUid() === state.uid;
  return {
    activate(uid: string, confirmedCloudState: BackupState) {
      session = uid ? { uid, revision: 0, dirty: true, lastSaved: JSON.stringify(confirmedCloudState), failures: 0, inflight: null } : null;
    },
    clear() { session = null; },
    markDirty() {
      if (!session) return;
      session.revision += 1;
      session.dirty = true;
    },
    pending() { return Boolean(session?.dirty); },
    flush(): Promise<void> {
      const state = session;
      if (!state || !isCurrent(state)) return Promise.resolve();
      if (state.inflight) return state.inflight;
      // Defer execution one microtask so even synchronous read failures run
      // finally after the promise has been installed on this session.
      state.inflight = Promise.resolve().then(async () => {
        if (!isCurrent(state)) return;
        const revision = state.revision;
        let saved = false;
        try {
          const value = options.read(state.uid);
          const snapshot = JSON.stringify(value);
          if (snapshot === state.lastSaved) {
            state.dirty = false;
            state.failures = 0;
            return;
          }
          await options.save(state.uid, value);
          if (!isCurrent(state)) return;
          state.lastSaved = snapshot;
          state.failures = 0;
          state.dirty = state.revision !== revision;
          saved = true;
          options.onSuccess();
        } catch (error) {
          if (!isCurrent(state)) return;
          state.dirty = true;
          state.failures += 1;
          options.onError(error);
        } finally {
          state.inflight = null;
          if (isCurrent(state) && state.dirty) {
            options.schedule(saved ? 500 : Math.min(120_000, 2000 * 2 ** Math.min(6, state.failures - 1)));
          }
        }
      });
      return state.inflight;
    },
  };
}
