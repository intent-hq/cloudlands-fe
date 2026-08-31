import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import HoverCard from '../HoverCard.svelte';

const TEST_ANCHOR = '--test-hover-anchor';

describe('HoverCard positioning', () => {
  let rafCallbacks: FrameRequestCallback[];
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rafCallbacks = [];
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });
  });

  afterEach(() => {
    cleanup();
    // Drain the shared layout-phases queue so state does not leak across tests.
    flushFrames();
    rafSpy.mockRestore();
    document.body.innerHTML = '';
  });

  function flushFrames() {
    let guard = 0;
    while (rafCallbacks.length > 0 && guard < 10) {
      const batch = rafCallbacks;
      rafCallbacks = [];
      for (const cb of batch) cb(performance.now());
      guard += 1;
    }
  }

  function createTrigger(parent: HTMLElement = document.body) {
    const trigger = document.createElement('button');
    parent.appendChild(trigger);
    return trigger;
  }

  async function mountWithAnchorElement(trigger: HTMLElement) {
    const result = render(HoverCard, {
      props: { anchor: TEST_ANCHOR, anchorElement: trigger },
    });
    // Let the tick-based initial measurement settle before counting.
    await tick();
    await tick();
    flushFrames();
    return result;
  }

  it('performs a single initial measurement on mount', async () => {
    const trigger = createTrigger();
    const rectSpy = vi.spyOn(trigger, 'getBoundingClientRect');

    await mountWithAnchorElement(trigger);

    expect(rectSpy).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of scroll events into one batched measurement', async () => {
    const trigger = createTrigger();
    await mountWithAnchorElement(trigger);
    const rectSpy = vi.spyOn(trigger, 'getBoundingClientRect');

    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));

    // Nothing measured synchronously; everything waits for the layout-read phase.
    expect(rectSpy).not.toHaveBeenCalled();
    flushFrames();
    expect(rectSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores scrolls of containers that are not ancestors of the trigger', async () => {
    const triggerParent = document.createElement('div');
    const unrelated = document.createElement('div');
    document.body.appendChild(triggerParent);
    document.body.appendChild(unrelated);
    const trigger = createTrigger(triggerParent);
    await mountWithAnchorElement(trigger);
    const rectSpy = vi.spyOn(trigger, 'getBoundingClientRect');

    unrelated.dispatchEvent(new Event('scroll'));
    flushFrames();
    expect(rectSpy).not.toHaveBeenCalled();

    triggerParent.dispatchEvent(new Event('scroll'));
    flushFrames();
    expect(rectSpy).toHaveBeenCalledTimes(1);
  });

  it('schedules window resize measurements through the layout-read phase', async () => {
    const trigger = createTrigger();
    await mountWithAnchorElement(trigger);
    const rectSpy = vi.spyOn(trigger, 'getBoundingClientRect');

    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));

    expect(rectSpy).not.toHaveBeenCalled();
    flushFrames();
    expect(rectSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves an anchor string once and reuses the cached trigger element', async () => {
    const decoy = document.createElement('div');
    decoy.setAttribute('style', 'anchor-name: --other-anchor');
    const trigger = document.createElement('button');
    trigger.setAttribute('style', `anchor-name: ${TEST_ANCHOR}`);
    document.body.appendChild(decoy);
    document.body.appendChild(trigger);

    const computedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (el) =>
        ({
          getPropertyValue: (prop: string) =>
            prop === 'anchor-name' && el === trigger ? TEST_ANCHOR : '',
        }) as CSSStyleDeclaration,
    );

    render(HoverCard, { props: { anchor: TEST_ANCHOR } });
    await tick();
    await tick();
    flushFrames();
    expect(computedStyleSpy).toHaveBeenCalled();
    computedStyleSpy.mockClear();
    const rectSpy = vi.spyOn(trigger, 'getBoundingClientRect');

    window.dispatchEvent(new Event('scroll'));
    flushFrames();

    // The cached trigger is reused: measured again without re-scanning the DOM.
    expect(rectSpy).toHaveBeenCalledTimes(1);
    expect(computedStyleSpy).not.toHaveBeenCalled();
    computedStyleSpy.mockRestore();
  });

  it('keeps re-measuring on scroll after the cached trigger is re-created', async () => {
    const trigger = document.createElement('button');
    trigger.setAttribute('style', `anchor-name: ${TEST_ANCHOR}`);
    document.body.appendChild(trigger);

    render(HoverCard, { props: { anchor: TEST_ANCHOR } });
    await tick();
    await tick();
    flushFrames();

    // Simulate the trigger node being re-created while the card is open.
    trigger.remove();
    const newTrigger = document.createElement('button');
    newTrigger.setAttribute('style', `anchor-name: ${TEST_ANCHOR}`);
    document.body.appendChild(newTrigger);
    const rectSpy = vi.spyOn(newTrigger, 'getBoundingClientRect');

    // A document scroll must not be suppressed by the stale (disconnected)
    // cache entry: document.contains(disconnectedNode) is false, so only the
    // stale-cache fallback lets the re-scan resolve and measure the new
    // trigger. (Dispatching on window would bypass the ancestor filter, since
    // window is not a Node.)
    document.dispatchEvent(new Event('scroll'));
    flushFrames();

    expect(rectSpy).toHaveBeenCalledTimes(1);
  });

  it('re-resolves when the cached element is re-anchored to a different name', async () => {
    const trigger = document.createElement('button');
    trigger.setAttribute('style', `anchor-name: ${TEST_ANCHOR}`);
    document.body.appendChild(trigger);

    render(HoverCard, { props: { anchor: TEST_ANCHOR } });
    await tick();
    await tick();
    flushFrames();

    // The node stays connected but is reused for a different entity: its
    // anchor-name is rewritten, and a new element now carries the anchor.
    trigger.setAttribute('style', 'anchor-name: --other-anchor');
    const newTrigger = document.createElement('button');
    newTrigger.setAttribute('style', `anchor-name: ${TEST_ANCHOR}`);
    document.body.appendChild(newTrigger);
    const staleRectSpy = vi.spyOn(trigger, 'getBoundingClientRect');
    const rectSpy = vi.spyOn(newTrigger, 'getBoundingClientRect');

    window.dispatchEvent(new Event('scroll'));
    flushFrames();

    expect(staleRectSpy).not.toHaveBeenCalled();
    expect(rectSpy).toHaveBeenCalledTimes(1);
  });
});
