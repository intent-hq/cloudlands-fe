export const WORKSPACE_HOVER_CARD_OPEN_DELAY_MS = 400;
export const WORKSPACE_HOVER_CARD_CLOSE_GRACE_DELAY_MS = 175;
export const WORKSPACE_HOVER_CARD_SESSION_RESET_DELAY_MS = 300;

type OpenDelayListener = (delay: number) => void;

export function createWorkspaceHoverCardIntentSession() {
  let openCount = 0;
  let resetTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<OpenDelayListener>();

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
    reset() {
      const delayChanged = getCurrentOpenDelay() !== WORKSPACE_HOVER_CARD_OPEN_DELAY_MS;
      clearResetTimer();
      openCount = 0;
      if (delayChanged) notifyListeners();
    },
  };
}

export const workspaceHoverCardIntentSession = createWorkspaceHoverCardIntentSession();
