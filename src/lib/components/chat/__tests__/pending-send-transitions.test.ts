/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMessageSendLaunchBubble,
  MESSAGE_SEND_DISMISS_DURATION_MS,
  MESSAGE_SEND_MATCH_TIMEOUT_MS,
  type MessageSendOrigin,
} from '../message-send-transition';
import {
  createPendingSendTransitions,
  MESSAGE_SEND_MATCH_RETRY_INTERVAL_MS,
} from '../pending-send-transitions';
import PendingSendTransitionHost from './PendingSendTransitionHost.svelte';

const originalAnimate = HTMLElement.prototype.animate;
const originalScrollTo = HTMLElement.prototype.scrollTo;

function stubAnimate(implementation: () => { finished: Promise<void>; cancel?: () => void }) {
  const animate = vi.fn(implementation);
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: animate,
  });
  return animate;
}

function origin(): MessageSendOrigin {
  return { left: 16, top: 640, width: 480, height: 72, borderRadius: '8px' };
}

function setup(overrides?: { followBottom?: boolean }) {
  const scrollContainer = document.createElement('div');
  Object.defineProperties(scrollContainer, {
    scrollHeight: { value: 900 },
    clientHeight: { value: 600 },
  });
  scrollContainer.scrollTop = 240;
  document.body.append(scrollContainer);
  const setRowHidden = vi.fn();
  const transitions = createPendingSendTransitions({
    getScrollContainer: () => scrollContainer,
    setRowHidden,
  });
  const bubble = createMessageSendLaunchBubble(origin(), 'A sent message', 'panel-a')!;
  transitions.add('app-msg-1', {
    origin: origin(),
    launchBubble: bubble,
    followBottom: overrides?.followBottom ?? true,
  });
  return { scrollContainer, transitions, setRowHidden, bubble };
}

function appendRow(scrollContainer: HTMLElement, key: string): HTMLElement {
  const row = document.createElement('div');
  row.dataset.sendAppMessageId = key;
  const surface = document.createElement('div');
  surface.dataset.testid = 'user-message-surface';
  row.append(surface);
  scrollContainer.append(row);
  return surface;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: function ({ top }: ScrollToOptions) {
      this.scrollTop = Number(top ?? this.scrollTop);
    },
  });
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  if (originalAnimate) {
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: originalAnimate,
    });
  } else {
    delete (HTMLElement.prototype as { animate?: typeof HTMLElement.prototype.animate }).animate;
  }
  if (originalScrollTo) {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: originalScrollTo,
    });
  } else {
    delete (HTMLElement.prototype as { scrollTo?: typeof HTMLElement.prototype.scrollTo }).scrollTo;
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('pending send transitions controller', () => {
  it('starts the transition when the target row appears several ticks late', async () => {
    const animate = stubAnimate(() => ({ finished: Promise.resolve() }));
    const { scrollContainer, transitions, setRowHidden } = setup();
    expect(setRowHidden).toHaveBeenCalledWith('app-msg-1', true);

    expect(transitions.attemptMatches()).toBe(false);
    await vi.advanceTimersByTimeAsync(MESSAGE_SEND_MATCH_RETRY_INTERVAL_MS * 4);
    expect(animate).not.toHaveBeenCalled();
    expect(transitions.hasPending()).toBe(true);

    appendRow(scrollContainer, 'app-msg-1');
    await vi.advanceTimersByTimeAsync(MESSAGE_SEND_MATCH_RETRY_INTERVAL_MS);

    expect(animate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ duration: 280 }),
    );
    expect(transitions.hasPending()).toBe(false);
    expect(setRowHidden).toHaveBeenLastCalledWith('app-msg-1', false);
    expect(document.querySelector('[data-message-send-transition]')).toBeNull();
  });

  it('matches immediately from an explicit attempt when the row is present', () => {
    stubAnimate(() => ({ finished: Promise.resolve() }));
    const { scrollContainer, transitions } = setup();
    appendRow(scrollContainer, 'app-msg-1');
    expect(transitions.attemptMatches()).toBe(true);
    expect(transitions.hasPending()).toBe(false);
  });

  it('expires gracefully: fades the bubble, un-hides the row, follows bottom', async () => {
    const animate = stubAnimate(() => ({ finished: Promise.resolve() }));
    const { scrollContainer, transitions, setRowHidden } = setup();

    await vi.advanceTimersByTimeAsync(MESSAGE_SEND_MATCH_TIMEOUT_MS);

    expect(setRowHidden).toHaveBeenLastCalledWith('app-msg-1', false);
    expect(scrollContainer.scrollTop).toBe(300);
    expect(animate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ duration: MESSAGE_SEND_DISMISS_DURATION_MS }),
    );
    expect(transitions.hasPending()).toBe(false);
    expect(document.querySelector('[data-message-send-transition]')).toBeNull();
  });

  it('does not scroll on expiry when follow was not requested', async () => {
    stubAnimate(() => ({ finished: Promise.resolve() }));
    const { scrollContainer, setRowHidden } = setup({ followBottom: false });

    await vi.advanceTimersByTimeAsync(MESSAGE_SEND_MATCH_TIMEOUT_MS);

    expect(scrollContainer.scrollTop).toBe(240);
    expect(setRowHidden).toHaveBeenLastCalledWith('app-msg-1', false);
    expect(document.querySelector('[data-message-send-transition]')).toBeNull();
  });

  it('does not start a transition for a row that appears after expiry', async () => {
    const animate = stubAnimate(() => ({ finished: Promise.resolve() }));
    const { scrollContainer, transitions, setRowHidden } = setup();

    await vi.advanceTimersByTimeAsync(MESSAGE_SEND_MATCH_TIMEOUT_MS);
    animate.mockClear();
    setRowHidden.mockClear();

    appendRow(scrollContainer, 'app-msg-1');
    expect(transitions.attemptMatches()).toBe(false);
    await vi.advanceTimersByTimeAsync(MESSAGE_SEND_MATCH_RETRY_INTERVAL_MS * 4);

    expect(animate).not.toHaveBeenCalled();
    expect(setRowHidden).not.toHaveBeenCalledWith('app-msg-1', true);
  });

  it('cancelAll removes the bubble immediately and un-hides the row', () => {
    stubAnimate(() => ({ finished: Promise.resolve() }));
    const { transitions, setRowHidden, bubble } = setup();

    transitions.cancelAll();

    expect(bubble.isConnected).toBe(false);
    expect(transitions.hasPending()).toBe(false);
    expect(setRowHidden).toHaveBeenLastCalledWith('app-msg-1', false);
    expect(document.querySelector('[data-message-send-transition]')).toBeNull();
  });

  it('cancelAll removes a bubble that is mid-dismissal fade after expiry', async () => {
    stubAnimate(() => ({ finished: new Promise(() => {}) }));
    const { transitions, bubble } = setup();

    await vi.advanceTimersByTimeAsync(MESSAGE_SEND_MATCH_TIMEOUT_MS);
    expect(bubble.isConnected).toBe(true);

    transitions.cancelAll();

    expect(bubble.isConnected).toBe(false);
    expect(document.querySelector('[data-message-send-transition]')).toBeNull();
  });

  it('keeps retrying while the scroll container is unbound and matches once it binds', async () => {
    const animate = stubAnimate(() => ({ finished: Promise.resolve() }));
    let scrollContainer: HTMLElement | null = null;
    const setRowHidden = vi.fn();
    const transitions = createPendingSendTransitions({
      getScrollContainer: () => scrollContainer,
      setRowHidden,
    });
    const bubble = createMessageSendLaunchBubble(origin(), 'Late container', 'panel-a')!;
    transitions.add('app-msg-1', { origin: origin(), launchBubble: bubble, followBottom: true });

    // Container binds only a few retry intervals later — the loop must survive
    // the unbound-container early return instead of stopping.
    await vi.advanceTimersByTimeAsync(MESSAGE_SEND_MATCH_RETRY_INTERVAL_MS * 3);
    expect(transitions.hasPending()).toBe(true);

    scrollContainer = document.createElement('div');
    document.body.append(scrollContainer);
    appendRow(scrollContainer, 'app-msg-1');
    await vi.advanceTimersByTimeAsync(MESSAGE_SEND_MATCH_RETRY_INTERVAL_MS);

    expect(animate).toHaveBeenCalled();
    expect(transitions.hasPending()).toBe(false);
    expect(setRowHidden).toHaveBeenLastCalledWith('app-msg-1', false);
  });

  it('tracks two concurrent keys independently: one matches, the other expires', async () => {
    const animate = stubAnimate(() => ({ finished: Promise.resolve() }));
    const { scrollContainer, transitions, setRowHidden } = setup();
    const secondBubble = createMessageSendLaunchBubble(origin(), 'Overlap send', 'panel-a')!;
    transitions.add('app-msg-2', {
      origin: origin(),
      launchBubble: secondBubble,
      followBottom: true,
    });

    appendRow(scrollContainer, 'app-msg-2');
    await vi.advanceTimersByTimeAsync(MESSAGE_SEND_MATCH_RETRY_INTERVAL_MS);

    expect(animate).toHaveBeenCalledTimes(1);
    expect(setRowHidden).toHaveBeenLastCalledWith('app-msg-2', false);
    expect(transitions.hasPending()).toBe(true);

    await vi.advanceTimersByTimeAsync(MESSAGE_SEND_MATCH_TIMEOUT_MS);

    expect(transitions.hasPending()).toBe(false);
    expect(setRowHidden).toHaveBeenCalledWith('app-msg-1', false);
    expect(document.querySelector('[data-message-send-transition]')).toBeNull();
  });

  it('never hides the row for a null launch bubble and still cleans up on expiry', async () => {
    stubAnimate(() => ({ finished: Promise.resolve() }));
    const scrollContainer = document.createElement('div');
    document.body.append(scrollContainer);
    const setRowHidden = vi.fn();
    const transitions = createPendingSendTransitions({
      getScrollContainer: () => scrollContainer,
      setRowHidden,
    });
    transitions.add('app-msg-1', { origin: origin(), launchBubble: null, followBottom: false });

    expect(setRowHidden).toHaveBeenCalledWith('app-msg-1', false);
    expect(setRowHidden).not.toHaveBeenCalledWith('app-msg-1', true);

    await vi.advanceTimersByTimeAsync(MESSAGE_SEND_MATCH_TIMEOUT_MS);

    expect(transitions.hasPending()).toBe(false);
    expect(setRowHidden).toHaveBeenLastCalledWith('app-msg-1', false);
  });

  it('replaces a re-added key: the stale bubble is removed and its expiry cleared', async () => {
    const animate = stubAnimate(() => ({ finished: Promise.resolve() }));
    const { scrollContainer, transitions, bubble } = setup();

    const secondBubble = createMessageSendLaunchBubble(origin(), 'Second send', 'panel-a')!;
    transitions.add('app-msg-1', {
      origin: origin(),
      launchBubble: secondBubble,
      followBottom: true,
    });

    expect(bubble.isConnected).toBe(false);
    expect(secondBubble.isConnected).toBe(true);

    appendRow(scrollContainer, 'app-msg-1');
    await vi.advanceTimersByTimeAsync(MESSAGE_SEND_MATCH_RETRY_INTERVAL_MS);
    expect(animate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ duration: 280 }),
    );
    expect(transitions.hasPending()).toBe(false);
  });
});

describe('pending send transitions in a component lifecycle', () => {
  async function clickByTestId(container: HTMLElement, testId: string): Promise<void> {
    container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click();
    await vi.advanceTimersByTimeAsync(0);
  }

  it('hides the late row until the retried match starts the transition', async () => {
    const animate = stubAnimate(() => ({ finished: Promise.resolve() }));
    const { container } = render(PendingSendTransitionHost, { props: { panelId: 'panel-host' } });

    await clickByTestId(container, 'prepare-button');
    expect(document.querySelector('[data-message-send-transition]')).not.toBeNull();

    await vi.advanceTimersByTimeAsync(MESSAGE_SEND_MATCH_RETRY_INTERVAL_MS * 3);
    expect(document.querySelector('[data-message-send-transition]')).not.toBeNull();

    await clickByTestId(container, 'append-row-button');
    const row = container.querySelector<HTMLElement>('[data-send-app-message-id]')!;
    expect(row.classList.contains('invisible')).toBe(true);

    await vi.advanceTimersByTimeAsync(MESSAGE_SEND_MATCH_RETRY_INTERVAL_MS);
    expect(animate).toHaveBeenCalled();
    expect(row.classList.contains('invisible')).toBe(false);
    expect(document.querySelector('[data-message-send-transition]')).toBeNull();
  });

  it('unmount mid-pending removes the launch bubble and stops the retry loop', async () => {
    stubAnimate(() => ({ finished: Promise.resolve() }));
    const { container, unmount } = render(PendingSendTransitionHost, {
      props: { panelId: 'panel-unmount' },
    });

    await clickByTestId(container, 'prepare-button');
    expect(document.querySelector('[data-message-send-transition]')).not.toBeNull();

    unmount();

    expect(document.querySelector('[data-message-send-transition]')).toBeNull();
    await vi.advanceTimersByTimeAsync(MESSAGE_SEND_MATCH_TIMEOUT_MS);
    expect(document.querySelector('[data-message-send-transition]')).toBeNull();
  });
});
