import {
  animateMessageSend,
  dismissMessageSendLaunchBubble,
  MESSAGE_SEND_MATCH_TIMEOUT_MS,
  type MessageSendOrigin,
} from './message-send-transition';

export const MESSAGE_SEND_MATCH_RETRY_INTERVAL_MS = 50;

export interface PendingSendEntry {
  origin: MessageSendOrigin;
  launchBubble: HTMLElement | null;
  followBottom: boolean;
}

interface InternalPendingSendEntry extends PendingSendEntry {
  expiry: ReturnType<typeof setTimeout>;
}

export interface PendingSendTransitionsOptions {
  /** Live accessor — the scroll container binds after mount and can change. */
  getScrollContainer: () => HTMLElement | null | undefined;
  /** Mirror of the pending set used to hide the real transcript row. */
  setRowHidden: (key: string, hidden: boolean) => void;
  matchTimeoutMs?: number;
  retryIntervalMs?: number;
}

export interface PendingSendTransitions {
  add(key: string, entry: PendingSendEntry): void;
  /** Try to start every matchable pending transition. Returns true if any started. */
  attemptMatches(): boolean;
  hasPending(): boolean;
  cancelAll(): void;
}

/**
 * Tracks launch bubbles waiting for their transcript row to appear.
 *
 * Matching is retried on a short interval until the match timeout instead of
 * being attempted once: the target row can enter the DOM a tick (or several)
 * after the message-count effect fires, or without any count increase at all
 * (canonical echo replacing the optimistic row, transcript reconciliation).
 * On timeout the bubble fades out gracefully, the real row is un-hidden, and
 * the transcript is scrolled to the bottom when follow was requested — the
 * sent message is never left invisible and no overlay is left behind.
 */
export function createPendingSendTransitions(
  options: PendingSendTransitionsOptions,
): PendingSendTransitions {
  const {
    getScrollContainer,
    setRowHidden,
    matchTimeoutMs = MESSAGE_SEND_MATCH_TIMEOUT_MS,
    retryIntervalMs = MESSAGE_SEND_MATCH_RETRY_INTERVAL_MS,
  } = options;
  const pendings = new Map<string, InternalPendingSendEntry>();
  const activeTransitions = new Map<string, AbortController>();
  let retryTimer: ReturnType<typeof setInterval> | null = null;

  function stopRetryLoopIfIdle(): void {
    if (pendings.size === 0 && retryTimer !== null) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
  }

  function expire(key: string): void {
    const pending = pendings.get(key);
    if (!pending) return;
    pendings.delete(key);
    // Un-hide first: if the row renders after the timeout it must be visible.
    setRowHidden(key, false);
    const scrollContainer = getScrollContainer();
    if (pending.followBottom && scrollContainer) {
      scrollContainer.scrollTop = Math.max(
        0,
        scrollContainer.scrollHeight - scrollContainer.clientHeight,
      );
    }
    void dismissMessageSendLaunchBubble(pending.launchBubble);
    stopRetryLoopIfIdle();
  }

  function add(key: string, entry: PendingSendEntry): void {
    const existing = pendings.get(key);
    if (existing) {
      clearTimeout(existing.expiry);
      existing.launchBubble?.remove();
    }
    pendings.set(key, { ...entry, expiry: setTimeout(() => expire(key), matchTimeoutMs) });
    if (entry.launchBubble) setRowHidden(key, true);
    retryTimer ??= setInterval(() => {
      attemptMatches();
    }, retryIntervalMs);
  }

  function attemptMatches(): boolean {
    const scrollContainer = getScrollContainer();
    if (!scrollContainer || pendings.size === 0) {
      stopRetryLoopIfIdle();
      return false;
    }
    let started = false;
    for (const [key, pending] of [...pendings]) {
      const row = scrollContainer.querySelector<HTMLElement>(
        `[data-send-app-message-id="${CSS.escape(key)}"]`,
      );
      if (!row) continue;
      clearTimeout(pending.expiry);
      pendings.delete(key);
      const target = row.querySelector<HTMLElement>('[data-testid="user-message-surface"]') ?? row;
      activeTransitions.get(key)?.abort();
      const controller = new AbortController();
      activeTransitions.set(key, controller);
      const settle = () => {
        if (activeTransitions.get(key) === controller) activeTransitions.delete(key);
        setRowHidden(key, false);
      };
      void animateMessageSend({
        origin: pending.origin,
        target,
        scrollContainer,
        launchBubble: pending.launchBubble,
        followBottom: pending.followBottom,
        signal: controller.signal,
      }).then(settle, settle);
      started = true;
    }
    stopRetryLoopIfIdle();
    return started;
  }

  function cancelAll(): void {
    for (const [key, pending] of pendings) {
      clearTimeout(pending.expiry);
      pending.launchBubble?.remove();
      setRowHidden(key, false);
    }
    pendings.clear();
    for (const controller of activeTransitions.values()) controller.abort();
    activeTransitions.clear();
    stopRetryLoopIfIdle();
  }

  return { add, attemptMatches, hasPending: () => pendings.size > 0, cancelAll };
}
