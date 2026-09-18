export type LocalStateBackup = Record<string, string>;

export function localStateBackupKeys(uid: string) {
  return [
    `route-scheduled-chat:${uid}`,
    `route-date-plans:${uid}`,
    `route-local-schedules:${uid}`,
    `meluni-location-visits:${uid}`,
    `meluni-location-sharing:${uid}`,
    'route.memories.deleted.v1',
  ];
}

export function readLocalStateBackup(uid: string, storage: Pick<Storage, 'getItem'>): LocalStateBackup {
  const result: LocalStateBackup = {};
  for (const key of localStateBackupKeys(uid)) {
    const value = storage.getItem(key);
    if (value !== null) result[key] = value;
  }
  return result;
}

export function validLocalStateBackup(uid: string, value: unknown): LocalStateBackup {
  const result: LocalStateBackup = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const key of localStateBackupKeys(uid)) {
    const entry = (value as Record<string, unknown>)[key];
    if (Object.hasOwn(value, key) && typeof entry === 'string') result[key] = entry;
  }
  return result;
}
