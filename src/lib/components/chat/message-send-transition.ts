import { USER_MESSAGE_SURFACE_CLASS, USER_MESSAGE_TEXT_CLASS } from './user-message-surface';
import { followToBottom } from '$lib/utils/smartScroll';

export const MESSAGE_SEND_TRANSITION_DURATION_MS = 280;
export const MESSAGE_SEND_TRANSITION_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
export const MESSAGE_SEND_TRANSITION_MAX_SETTLE_MS = 600;
export const MESSAGE_SEND_MATCH_TIMEOUT_MS = 3000;
export const MESSAGE_SEND_DISMISS_DURATION_MS = 160;

interface TargetTransitionOwner {
  cancel: () => void;
}

const targetTransitionOwners = new WeakMap<HTMLElement, TargetTransitionOwner>();

export interface MessageSendOrigin {
  left: number;
  top: number;
  width: number;
  height: number;
  borderRadius: string;
}

interface AnimateMessageSendOptions {
  origin: MessageSendOrigin;
  target: HTMLElement;
  scrollContainer: HTMLElement;
  launchBubble?: HTMLElement | null;
  followBottom?: boolean;
  reducedMotion?: boolean;
  signal?: AbortSignal;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function captureMessageSendOrigin(composer: HTMLElement): MessageSendOrigin {
  const source = composer.querySelector<HTMLElement>('[data-testid="message-input"]') ?? composer;
  const rect = source.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    borderRadius: getComputedStyle(source).borderRadius || '0px',
  };
}

export function createMessageSendLaunchBubble(
  origin: MessageSendOrigin,
  text: string,
  ownerId?: string,
): HTMLElement | null {
  if (prefersReducedMotion()) return null;
  const bubble = document.createElement('div');
  const body = document.createElement('div');
  bubble.dataset.messageSendTransition = 'true';
  if (ownerId) bubble.dataset.messageSendOwner = ownerId;
  bubble.setAttribute('aria-hidden', 'true');
  bubble.className = USER_MESSAGE_SURFACE_CLASS;
  body.className = USER_MESSAGE_TEXT_CLASS;
  body.textContent = text;
  bubble.append(body);
  Object.assign(bubble.style, {
    position: 'fixed',
    pointerEvents: 'none',
    left: `${origin.left}px`,
    top: `${origin.top}px`,
    width: `${origin.width}px`,
    maxWidth: 'calc(100vw - 16px)',
    boxSizing: 'border-box',
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
    willChange: 'transform',
    zIndex: '70',
  });
  document.body.append(bubble);
  return bubble;
}

/**
 * Gracefully retires a launch bubble whose transcript row never appeared
 * (match timeout). Fades the bubble out in place instead of yanking it, and
 * always removes it from the DOM before resolving.
 */
export function dismissMessageSendLaunchBubble(bubble: HTMLElement | null): Promise<void> {
  if (!bubble) return Promise.resolve();
  if (
    !bubble.isConnected ||
    prefersReducedMotion() ||
    document.hidden ||
    typeof bubble.animate !== 'function'
  ) {
    bubble.remove();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (watchdog !== null) clearTimeout(watchdog);
      bubble.remove();
      resolve();
    };
    watchdog = setTimeout(finish, MESSAGE_SEND_TRANSITION_MAX_SETTLE_MS);
    try {
      const animation = bubble.animate(
        [
          { opacity: 1, transform: 'translate3d(0, 0, 0)' },
          { opacity: 0, transform: 'translate3d(0, 8px, 0)' },
        ],
        {
          duration: MESSAGE_SEND_DISMISS_DURATION_MS,
          easing: MESSAGE_SEND_TRANSITION_EASING,
          fill: 'forwards',
        },
      );
      void animation.finished.then(finish, finish);
    } catch {
      finish();
    }
  });
}

export function settleFollowedSendAtBottom(
  scrollContainer: HTMLElement,
  shouldFollow: () => boolean,
): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (scrollContainer.isConnected && shouldFollow()) {
          followToBottom(scrollContainer);
        }
        resolve();
      });
    });
  });
}

export function animateMessageSend({
  origin,
  target,
  scrollContainer,
  launchBubble,
  followBottom = true,
  reducedMotion = prefersReducedMotion(),
  signal,
}: AnimateMessageSendOptions): Promise<void> {
  let animation: Animation | null = null;
  let geometryObserver: ResizeObserver | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let overlay: HTMLElement | null = launchBubble ?? null;
  let settled = false;
  let resolveFinished: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  let previousVisibility = target.style.visibility;
  const owner: TargetTransitionOwner = { cancel: () => cleanup() };
  const handleAbort = () => cleanup();
  const handlePageHide = () => cleanup();
  const handleViewportResize = () => cleanup();
  const handleVisibilityChange = () => {
    if (document.hidden) cleanup();
  };

  function cleanup(): void {
    if (settled) return;
    settled = true;
    if (watchdog !== null) clearTimeout(watchdog);
    signal?.removeEventListener('abort', handleAbort);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('resize', handleViewportResize);
    geometryObserver?.disconnect();
    try {
      animation?.cancel();
    } catch {
      // Cancellation is best-effort; visual cleanup must still complete.
    }
    overlay?.remove();
    if (targetTransitionOwners.get(target) === owner) {
      targetTransitionOwners.delete(target);
      if (target.style.visibility === 'hidden') target.style.visibility = previousVisibility;
    }
    resolveFinished();
  }

  try {
    if (followBottom) {
      followToBottom(scrollContainer);
    }
    if (reducedMotion || !target.isConnected || signal?.aborted || document.hidden) {
      cleanup();
      return finished;
    }

    targetTransitionOwners.get(target)?.cancel();
    previousVisibility = target.style.visibility;
    targetTransitionOwners.set(target, owner);
    const sourceRect = overlay?.getBoundingClientRect() ?? {
      left: origin.left,
      top: origin.top,
      width: origin.width,
      height: origin.height,
    };
    const targetRect = target.getBoundingClientRect();
    overlay ??= target.cloneNode(true) as HTMLElement;
    const targetRadius = getComputedStyle(target).borderRadius || origin.borderRadius;
    const startScaleX = targetRect.width > 0 ? sourceRect.width / targetRect.width : 1;
    const startScaleY = targetRect.height > 0 ? sourceRect.height / targetRect.height : 1;

    overlay.dataset.messageSendTransition = 'true';
    overlay.setAttribute('aria-hidden', 'true');
    Object.assign(overlay.style, {
      position: 'fixed',
      pointerEvents: 'none',
      left: `${targetRect.left}px`,
      top: `${targetRect.top}px`,
      width: `${targetRect.width}px`,
      height: `${targetRect.height}px`,
      maxWidth: 'calc(100vw - 16px)',
      boxSizing: 'border-box',
      overflowWrap: 'anywhere',
      transformOrigin: 'top left',
      willChange: 'transform',
      borderRadius: targetRadius,
      zIndex: '70',
    });
    target.style.visibility = 'hidden';
    if (!overlay.isConnected) document.body.append(overlay);
    if (typeof overlay.animate !== 'function') {
      cleanup();
      return finished;
    }

    signal?.addEventListener('abort', handleAbort, { once: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide, { once: true });
    window.addEventListener('resize', handleViewportResize, { once: true });
    if (typeof ResizeObserver !== 'undefined') {
      geometryObserver = new ResizeObserver(() => {
        const currentRect = target.getBoundingClientRect();
        if (
          Math.abs(currentRect.width - targetRect.width) > 0.5 ||
          Math.abs(currentRect.height - targetRect.height) > 0.5
        ) {
          cleanup();
        }
      });
      geometryObserver.observe(target);
    }
    watchdog = setTimeout(cleanup, MESSAGE_SEND_TRANSITION_MAX_SETTLE_MS);
    if (signal?.aborted || document.hidden) {
      cleanup();
      return finished;
    }
    animation = overlay.animate(
      [
        {
          transform: `translate3d(${sourceRect.left - targetRect.left}px, ${sourceRect.top - targetRect.top}px, 0) scale(${startScaleX}, ${startScaleY})`,
        },
        { transform: 'translate3d(0, 0, 0) scale(1)' },
      ],
      {
        duration: MESSAGE_SEND_TRANSITION_DURATION_MS,
        easing: MESSAGE_SEND_TRANSITION_EASING,
        fill: 'both',
      },
    );
    void animation.finished.then(cleanup, cleanup);
  } catch {
    cleanup();
  }

  return finished;
}
