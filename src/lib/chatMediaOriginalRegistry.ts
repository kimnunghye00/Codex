let pendingOriginals: File[] = [];

export function registerPendingOriginalChatFiles(files: File[]) {
  pendingOriginals = files.slice();
}

export function getPendingOriginalChatFile(index: number) {
  return pendingOriginals[index];
}

export function clearPendingOriginalChatFiles() {
  pendingOriginals = [];
}
