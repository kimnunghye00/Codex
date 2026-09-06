export type AccountIsolationAction =
  | 'ready'
  | 'adopt-owner'
  | 'reset-orphan'
  | 'reset-switch'
  | 'reset-signout';

export function decideAccountIsolation(
  previousOwner: string,
  hasSharedCache: boolean,
  nextUid: string | null,
): AccountIsolationAction {
  if (!nextUid) {
    if (previousOwner) return 'reset-signout';
    return hasSharedCache ? 'reset-orphan' : 'ready';
  }

  if (!previousOwner) return hasSharedCache ? 'reset-orphan' : 'adopt-owner';
  if (previousOwner === nextUid) return 'ready';
  return 'reset-switch';
}
