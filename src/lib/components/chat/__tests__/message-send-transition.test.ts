/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  animateMessageSend,
  captureMessageSendOrigin,
  createMessageSendLaunchBubble,
  MESSAGE_SEND_TRANSITION_DURATION_MS,
  MESSAGE_SEND_TRANSITION_EASING,
  MESSAGE_SEND_TRANSITION_MAX_SETTLE_MS,
} from '../message-send-transition';
import {
  configuredVisualStates,
  exerciseVisualStates,
} from '$lib/components/__tests__/helpers/visual-state-characterization';

const originalAnimate = HTMLElement.prototype.animate;

function stubAnimate(implementation: () => { finished: Promise<void>; cancel?: () => void }) {
  const animate = vi.fn(implementation);
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: animate,
  });
  return animate;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function fixture(text = 'A sent message that wraps safely') {
  const composer = document.createElement('div');
  const input = document.createElement('div');
  input.dataset.testid = 'message-input';
  input.getBoundingClientRect = () => rect(16, 640, 480, 72);
  composer.append(input);
  const target = document.createElement('div');
  target.textContent = text;
  target.getBoundingClientRect = () => rect(32, 520, 448, 96);
  document.body.append(composer, target);
  const scrollContainer = document.createElement('div');
  Object.defineProperties(scrollContainer, {
    scrollHeight: { value: 900 },
    clientHeight: { value: 600 },
  });
  scrollContainer.scrollTop = 240;
  scrollContainer.scrollTo = vi.fn(({ top }: ScrollToOptions) => {
    scrollContainer.scrollTop = Number(top);
  });
  return { composer, target, scrollContainer };
}

beforeEach(() => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});

afterEach(() => {
  document.body.replaceChildren();
  if (originalAnimate) {
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: originalAnimate,
    });
  } else {
    delete (HTMLElement.prototype as { animate?: typeof HTMLElement.prototype.animate }).animate;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('message send transition', () => {
  it('affirms the composer-to-bubble transition in every required visual state', async () => {
    const observed = await exerciseVisualStates(async ({ reducedMotion }) => {
      const { composer, target, scrollContainer } = fixture();
      target.tabIndex = 0;
      const animate = stubAnimate(() => ({ finished: Promise.resolve() }));
      const origin = captureMessageSendOrigin(composer);
      await animateMessageSend({ origin, target, scrollContainer });
      return {
        container: composer,
        target,
        unmount: () => {
          composer.remove();
          target.remove();
        },
        assertCapability: () => {
          if (reducedMotion) expect(animate).not.toHaveBeenCalled();
          else
            expect(animate).toHaveBeenCalledWith(
              expect.any(Array),
              expect.objectContaining({ duration: 280 }),
            );
          expect(target.style.opacity).toBe('');
        },
      };
    });
    expect(observed).toEqual(configuredVisualStates);
  });

  it('uses the emphasized 280ms composer-to-bubble animation and smooth scroll', async () => {
    const { composer, target, scrollContainer } = fixture();
    const animate = stubAnimate(() => ({ finished: Promise.resolve() }));
    const origin = captureMessageSendOrigin(composer);
    const launchBubble = createMessageSendLaunchBubble(origin, 'A sent message');

    await animateMessageSend({ origin, target, scrollContainer, launchBubble });

    expect(MESSAGE_SEND_TRANSITION_DURATION_MS).toBe(280);
    expect(MESSAGE_SEND_TRANSITION_EASING).toBe('cubic-bezier(0.2, 0, 0, 1)');
    expect(scrollContainer.scrollTo).toHaveBeenCalledWith({ top: 300, behavior: 'smooth' });
    expect(animate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ duration: 280, easing: MESSAGE_SEND_TRANSITION_EASING }),
    );
    expect(document.querySelector('[data-message-send-transition]')).toBeNull();
    expect(target.style.opacity).toBe('');
  });

  it('settles a never-resolving animation within the independent maximum bound', async () => {
    vi.useFakeTimers();
    const { composer, target, scrollContainer } = fixture();
    const cancel = vi.fn();
    target.style.opacity = '0.42';
    stubAnimate(() => ({ finished: new Promise<void>(() => {}), cancel }));

    const transition = animateMessageSend({
      origin: captureMessageSendOrigin(composer),
      target,
      scrollContainer,
    });
    await vi.advanceTimersByTimeAsync(MESSAGE_SEND_TRANSITION_MAX_SETTLE_MS);
    await transition;

    expect(MESSAGE_SEND_TRANSITION_MAX_SETTLE_MS).toBe(600);
    expect(cancel).toHaveBeenCalledOnce();
    expect(target.style.opacity).toBe('0.42');
    expect(document.querySelector('[data-message-send-transition]')).toBeNull();
  });

  it('aborts immediately and restores exact styles on lifecycle cancellation', async () => {
    const { composer, target, scrollContainer } = fixture();
    const controller = new AbortController();
    const cancel = vi.fn();
    target.style.opacity = '0.27';
    stubAnimate(() => ({ finished: new Promise<void>(() => {}), cancel }));

    const transition = animateMessageSend({
      origin: captureMessageSendOrigin(composer),
      target,
      scrollContainer,
      signal: controller.signal,
    });
    controller.abort();
    await transition;

    expect(cancel).toHaveBeenCalledOnce();
    expect(target.style.opacity).toBe('0.27');
    expect(document.querySelector('[data-message-send-transition]')).toBeNull();
  });

  it('settles rejected animations without leaking styles', async () => {
    const { composer, target, scrollContainer } = fixture();
    const failure = deferred();
    stubAnimate(() => ({ finished: failure.promise, cancel: vi.fn() }));

    const transition = animateMessageSend({
      origin: captureMessageSendOrigin(composer),
      target,
      scrollContainer,
    });
    failure.reject(new Error('animation failed'));
    await expect(transition).resolves.toBeUndefined();
    expect(target.style.opacity).toBe('');
    expect(document.querySelector('[data-message-send-transition]')).toBeNull();
  });

  it('settles immediately when the page becomes hidden', async () => {
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const { composer, target, scrollContainer } = fixture();
    const cancel = vi.fn();
    stubAnimate(() => ({ finished: new Promise<void>(() => {}), cancel }));

    const transition = animateMessageSend({
      origin: captureMessageSendOrigin(composer),
      target,
      scrollContainer,
    });
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await transition;

    expect(cancel).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-message-send-transition]')).toBeNull();
  });

  it('does not let an older cleanup restore over a newer transition on the same target', async () => {
    const { composer, target, scrollContainer } = fixture();
    const animations = [deferred(), deferred()];
    let index = 0;
    stubAnimate(() => ({ finished: animations[index++].promise, cancel: vi.fn() }));
    target.style.opacity = '0.33';
    const options = { origin: captureMessageSendOrigin(composer), target, scrollContainer };

    const first = animateMessageSend(options);
    const second = animateMessageSend(options);
    await first;
    expect(target.style.opacity).toBe('0');
    animations[0].resolve();
    await Promise.resolve();
    animations[1].resolve();
    await second;

    expect(target.style.opacity).toBe('0.33');
    expect(document.querySelector('[data-message-send-transition]')).toBeNull();
  });

  it('skips the overlay under reduced motion and contains long content', async () => {
    const longText = 'long-message '.repeat(200);
    const { composer, target, scrollContainer } = fixture(longText);
    const animate = stubAnimate(() => ({ finished: Promise.resolve() }));
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    expect(createMessageSendLaunchBubble(captureMessageSendOrigin(composer), longText)).toBeNull();

    await animateMessageSend({
      origin: captureMessageSendOrigin(composer),
      target,
      scrollContainer,
      reducedMotion: true,
    });
    expect(animate).not.toHaveBeenCalled();

    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    const controller = new AbortController();
    stubAnimate(() => ({ finished: new Promise<void>(() => {}), cancel: vi.fn() }));
    const transition = animateMessageSend({
      origin: captureMessageSendOrigin(composer),
      target,
      scrollContainer,
      signal: controller.signal,
    });
    const overlay = document.querySelector<HTMLElement>('[data-message-send-transition]')!;
    expect(overlay.textContent).toBe(longText);
    expect(overlay.style.maxWidth).toBe('calc(100vw - 16px)');
    expect(overlay.style.overflowWrap).toBe('anywhere');
    controller.abort();
    await transition;
  });
});
