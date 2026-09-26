export type ScheduledChatDraft = {
  id: number;
  text: string;
  sendAt: string;
  coupleId?: string;
};

export const SCHEDULED_CHAT_CHANGED = 'danduli-scheduled-chat-changed';
const keyFor = (uid: string) => `route-scheduled-chat:${uid}`;

export function parseScheduledChatDrafts(raw: string | null): ScheduledChatDraft[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<number>();
    return parsed.filter((value): value is ScheduledChatDraft => {
      if (!value || typeof value !== 'object') return false;
      const draft = value as Partial<ScheduledChatDraft>;
      const valid = Number.isSafeInteger(draft.id) && Number(draft.id) > 0
        && typeof draft.text === 'string' && draft.text.trim().length > 0
        && typeof draft.sendAt === 'string' && Number.isFinite(Date.parse(draft.sendAt))
        && (draft.coupleId === undefined || typeof draft.coupleId === 'string');
      if (!valid || seen.has(draft.id!)) return false;
      seen.add(draft.id!);
      return true;
    });
  } catch {
    return [];
  }
}

export function dueScheduledChatDrafts(drafts: ScheduledChatDraft[], coupleId: string, now: number) {
  return drafts.filter((draft) => draft.coupleId === coupleId && Date.parse(draft.sendAt) <= now)
    .sort((a, b) => Date.parse(a.sendAt) - Date.parse(b.sendAt));
}

export function loadScheduledChatDrafts(uid: string): ScheduledChatDraft[] {
  try { return parseScheduledChatDrafts(localStorage.getItem(keyFor(uid))); }
  catch { return []; }
}

function writeScheduledChatDrafts(uid: string, drafts: ScheduledChatDraft[]) {
  localStorage.setItem(keyFor(uid), JSON.stringify(drafts));
  window.dispatchEvent(new CustomEvent(SCHEDULED_CHAT_CHANGED, { detail: uid }));
}

export function addScheduledChatDraft(uid: string, draft: ScheduledChatDraft) {
  writeScheduledChatDrafts(uid, [...loadScheduledChatDrafts(uid), draft]);
}

export function removeScheduledChatDraft(uid: string, id: number, coupleId?: string) {
  const drafts = loadScheduledChatDrafts(uid);
  const next = drafts.filter((draft) => draft.id !== id || (coupleId !== undefined && draft.coupleId !== coupleId));
  if (next.length !== drafts.length) writeScheduledChatDrafts(uid, next);
}
