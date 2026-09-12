const originalScrollIntoView = Element.prototype.scrollIntoView;

function installChatScrollGuard() {
  if (document.documentElement.dataset.routeChatScrollGuard === '1') return;
  document.documentElement.dataset.routeChatScrollGuard = '1';

  // ChatPage maintains this dataset from its own scroll container. Keeping only
  // this guarded scrollIntoView override avoids three document-wide pointer/
  // wheel listeners that used to run on every screen for the lifetime of the app.
  Element.prototype.scrollIntoView = function routeGuardedScrollIntoView(arg?: boolean | ScrollIntoViewOptions) {
    const parent = this.parentElement?.closest('.chat-page .messages') as HTMLElement | null;
    if (parent?.dataset.routeUserAwayFromBottom === '1') return;
    return originalScrollIntoView.call(this, arg as ScrollIntoViewOptions);
  };
}

export function installRouteMobileBugfixV29() {
  installChatScrollGuard();
}
