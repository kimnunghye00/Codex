type TextEntry = HTMLInputElement | HTMLTextAreaElement;

type EntrySnapshot = {
  value: string;
  start: number | null;
  end: number | null;
  direction: 'forward' | 'backward' | 'none' | null;
};

const composing = new WeakSet<TextEntry>();
const revisions = new WeakMap<TextEntry, number>();

function asTextEntry(target: EventTarget | null): TextEntry | null {
  if (target instanceof HTMLTextAreaElement) return target;
  if (!(target instanceof HTMLInputElement)) return null;

  const type = (target.type || 'text').toLowerCase();
  if (['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type)) return null;
  return target;
}

function readSnapshot(entry: TextEntry): EntrySnapshot {
  return {
    value: entry.value,
    start: entry.selectionStart,
    end: entry.selectionEnd,
    direction: entry.selectionDirection,
  };
}

function setNativeValue(entry: TextEntry, value: string) {
  const prototype = entry instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(entry, value);
  else entry.value = value;
}

function restoreSnapshot(entry: TextEntry, snapshot: EntrySnapshot, revision: number, allowAfterComposition = false) {
  if (!document.contains(entry)) return;
  if (revisions.get(entry) !== revision) return;
  if (!allowAfterComposition && !composing.has(entry)) return;

  if (entry.value !== snapshot.value) setNativeValue(entry, snapshot.value);

  if (snapshot.start == null || snapshot.end == null) return;
  try {
    entry.setSelectionRange(snapshot.start, snapshot.end, snapshot.direction ?? undefined);
  } catch {
    // Some input types do not expose a selection range. Their value is still restored above.
  }
}

function protectCurrentNativeValue(entry: TextEntry, allowAfterComposition = false) {
  const revision = (revisions.get(entry) ?? 0) + 1;
  revisions.set(entry, revision);
  const snapshot = readSnapshot(entry);

  // React controlled inputs can rewrite the WebView value synchronously after
  // an IME input event. Re-apply the native value after React's event/update
  // cycle, and once more on the next frame for Android WebView rendering.
  queueMicrotask(() => restoreSnapshot(entry, snapshot, revision, allowAfterComposition));
  requestAnimationFrame(() => restoreSnapshot(entry, snapshot, revision, allowAfterComposition));
}

document.addEventListener('compositionstart', (event) => {
  const entry = asTextEntry(event.target);
  if (!entry) return;
  composing.add(entry);
}, true);

document.addEventListener('input', (event) => {
  const entry = asTextEntry(event.target);
  if (!entry || !composing.has(entry)) return;
  protectCurrentNativeValue(entry);
}, true);

document.addEventListener('compositionend', (event) => {
  const entry = asTextEntry(event.target);
  if (!entry) return;

  // Android normally fires one final input event after compositionend. Keep
  // the composing flag through the current task so that final value is also
  // protected, then finish with one last snapshot in case a keyboard omits it.
  queueMicrotask(() => protectCurrentNativeValue(entry, true));
  window.setTimeout(() => composing.delete(entry), 0);
}, true);
