export const WORKSPACE_HOVER_CARD_OPEN_DELAY_MS = 800;
export const WORKSPACE_HOVER_CARD_SESSION_RESET_DELAY_MS = 300;

type OpenDelayListener = (delay: number) => void;

export function createWorkspaceHoverCardIntentSession() {
  let openCount = 0;
  let resetTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<OpenDelayListener>();
  const deferredCloses = new Set<() => void>();

  function getCurrentOpenDelay() {
    return openCount > 0 || resetTimer !== null ? 0 : WORKSPACE_HOVER_CARD_OPEN_DELAY_MS;
  }

  function notifyListeners() {
    const delay = getCurrentOpenDelay();
    listeners.forEach((listener) => listener(delay));
  }

  function clearResetTimer() {
    if (resetTimer === null) return;
    clearTimeout(resetTimer);
    resetTimer = null;
  }

  return {
    get currentOpenDelay() {
      return getCurrentOpenDelay();
    },
    subscribe(listener: OpenDelayListener) {
      listeners.add(listener);
      listener(getCurrentOpenDelay());
      return () => listeners.delete(listener);
    },
    notifyOpened() {
      const wasIdle = openCount === 0 && resetTimer === null;
      clearResetTimer();
      openCount += 1;
      if (wasIdle) notifyListeners();
    },
    notifyClosed() {
      if (openCount === 0) return;
      openCount -= 1;
      if (openCount > 0) return;
      clearResetTimer();
      resetTimer = setTimeout(() => {
        resetTimer = null;
        notifyListeners();
      }, WORKSPACE_HOVER_CARD_SESSION_RESET_DELAY_MS);
    },
    /**
     * A trigger whose card is closing after a grace period (pointer heading
     * into the card) registers the close here; another trigger taking the
     * pointer settles it at once so two cards never linger side by side.
     */
    deferClose(close: () => void) {
      deferredCloses.add(close);
      return () => deferredCloses.delete(close);
    },
    settleDeferredCloses() {
      const closes = [...deferredCloses];
      deferredCloses.clear();
      closes.forEach((close) => close());
    },
    reset() {
      const delayChanged = getCurrentOpenDelay() !== WORKSPACE_HOVER_CARD_OPEN_DELAY_MS;
      clearResetTimer();
      openCount = 0;
      deferredCloses.clear();
      if (delayChanged) notifyListeners();
    },
  };
}

export const workspaceHoverCardIntentSession = createWorkspaceHoverCardIntentSession();
