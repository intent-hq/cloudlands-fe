import { USER_MESSAGE_SURFACE_CLASS, USER_MESSAGE_TEXT_CLASS } from './user-message-surface';

export const MESSAGE_SEND_TRANSITION_DURATION_MS = 280;
export const MESSAGE_SEND_TRANSITION_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
export const MESSAGE_SEND_TRANSITION_MAX_SETTLE_MS = 600;

interface TargetTransitionOwner {
  cancel: () => void;
}

const targetTransitionOwners = new WeakMap<HTMLElement, TargetTransitionOwner>();

export interface MessageSendOrigin {
  left: number;
  top: number;
  width: number;
  borderRadius: string;
}

interface AnimateMessageSendOptions {
  origin: MessageSendOrigin;
  target: HTMLElement;
  scrollContainer: HTMLElement;
  launchBubble?: HTMLElement | null;
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
    borderRadius: getComputedStyle(source).borderRadius || '0px',
  };
}

export function createMessageSendLaunchBubble(
  origin: MessageSendOrigin,
  text: string,
): HTMLElement | null {
  if (prefersReducedMotion()) return null;
  const bubble = document.createElement('div');
  const body = document.createElement('div');
  bubble.dataset.messageSendTransition = 'true';
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
    zIndex: '70',
  });
  document.body.append(bubble);
  return bubble;
}

export function animateMessageSend({
  origin,
  target,
  scrollContainer,
  launchBubble,
  reducedMotion = prefersReducedMotion(),
  signal,
}: AnimateMessageSendOptions): Promise<void> {
  let animation: Animation | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let overlay: HTMLElement | null = launchBubble ?? null;
  let settled = false;
  let resolveFinished: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  let previousOpacity = target.style.opacity;
  const owner: TargetTransitionOwner = { cancel: () => cleanup() };
  const handleAbort = () => cleanup();
  const handlePageHide = () => cleanup();
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
    try {
      animation?.cancel();
    } catch {
      // Cancellation is best-effort; visual cleanup must still complete.
    }
    overlay?.remove();
    if (targetTransitionOwners.get(target) === owner) {
      targetTransitionOwners.delete(target);
      if (target.style.opacity === '0') target.style.opacity = previousOpacity;
    }
    resolveFinished();
  }

  try {
    const targetScrollTop = Math.max(
      0,
      scrollContainer.scrollHeight - scrollContainer.clientHeight,
    );
    const scrollDelta = targetScrollTop - scrollContainer.scrollTop;
    scrollContainer.scrollTo({
      top: targetScrollTop,
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
    if (reducedMotion || !target.isConnected || signal?.aborted || document.hidden) {
      cleanup();
      return finished;
    }

    targetTransitionOwners.get(target)?.cancel();
    previousOpacity = target.style.opacity;
    targetTransitionOwners.set(target, owner);
    const targetRect = target.getBoundingClientRect();
    const finalTop = targetRect.top - scrollDelta;
    overlay ??= target.cloneNode(true) as HTMLElement;
    const targetRadius = getComputedStyle(target).borderRadius || origin.borderRadius;
    const startScale =
      targetRect.width > 0 ? Math.min(1.04, Math.max(0.82, origin.width / targetRect.width)) : 1;

    overlay.dataset.messageSendTransition = 'true';
    overlay.setAttribute('aria-hidden', 'true');
    Object.assign(overlay.style, {
      position: 'fixed',
      pointerEvents: 'none',
      left: `${targetRect.left}px`,
      top: `${finalTop}px`,
      width: `${targetRect.width}px`,
      maxWidth: 'calc(100vw - 16px)',
      boxSizing: 'border-box',
      overflowWrap: 'anywhere',
      transformOrigin: 'top left',
      willChange: 'transform, opacity, border-radius',
      zIndex: '70',
    });
    target.style.opacity = '0';
    if (!overlay.isConnected) document.body.append(overlay);
    if (typeof overlay.animate !== 'function') {
      cleanup();
      return finished;
    }

    signal?.addEventListener('abort', handleAbort, { once: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide, { once: true });
    watchdog = setTimeout(cleanup, MESSAGE_SEND_TRANSITION_MAX_SETTLE_MS);
    if (signal?.aborted || document.hidden) {
      cleanup();
      return finished;
    }
    animation = overlay.animate(
      [
        {
          transform: `translate(${origin.left - targetRect.left}px, ${origin.top - finalTop}px) scale(${startScale}, 0.96)`,
          opacity: 0.78,
          borderRadius: origin.borderRadius,
        },
        { transform: 'translate(0, 0) scale(1)', opacity: 1, borderRadius: targetRadius },
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
