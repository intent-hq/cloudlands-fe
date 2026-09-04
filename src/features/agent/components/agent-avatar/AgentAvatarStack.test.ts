import { cleanup, render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentAvatarStack, { type AgentAvatarStackItem } from './AgentAvatarStack.svelte';

function makeItems(count: number): AgentAvatarStackItem[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `agent-${index + 1}`,
    agentId: `agent-${index + 1}`,
  }));
}

function visibleKeys(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-agent-avatar-stack-item]')).map(
    (item) => item.getAttribute('data-agent-avatar-stack-key') ?? '',
  );
}

function overflowText(container: HTMLElement): string | null {
  return container.querySelector('[data-agent-avatar-overflow]')?.textContent?.trim() ?? null;
}

afterEach(cleanup);

describe('AgentAvatarStack capping (non-adaptive)', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'caps %i participants at maxVisible=3 and computes the badge from the remainder',
    (count) => {
      const { container } = render(AgentAvatarStack, {
        props: { items: makeItems(count), maxVisible: 3 },
      });
      const visible = Math.min(count, 3);
      expect(visibleKeys(container)).toEqual(
        makeItems(count)
          .slice(0, visible)
          .map((item) => item.key),
      );
      expect(overflowText(container)).toBe(count > visible ? `+${count - visible}` : null);
    },
  );

  it('keeps the badge and slice in sync when items change', async () => {
    const view = render(AgentAvatarStack, { props: { items: makeItems(6), maxVisible: 3 } });
    expect(visibleKeys(view.container)).toHaveLength(3);
    expect(overflowText(view.container)).toBe('+3');
    await view.rerender({ items: makeItems(12), maxVisible: 3 });
    expect(visibleKeys(view.container)).toEqual(['agent-1', 'agent-2', 'agent-3']);
    expect(overflowText(view.container)).toBe('+9');
  });

  it('respects other maxVisible values', () => {
    const { container } = render(AgentAvatarStack, {
      props: { items: makeItems(5), maxVisible: 1 },
    });
    expect(visibleKeys(container)).toEqual(['agent-1']);
    expect(overflowText(container)).toBe('+4');
  });
});

// In jsdom canvas.getContext('2d') is null, so the badge text width resolves to
// FALLBACK_OVERFLOW_TEXT_WIDTH (20px); the width thresholds below assume it.
describe('AgentAvatarStack capping (adaptive)', () => {
  class FakeResizeObserver {
    static instances: FakeResizeObserver[] = [];
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      FakeResizeObserver.instances.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    deliver(width: number) {
      this.callback(
        [
          {
            borderBoxSize: [{ inlineSize: width, blockSize: 24 }],
            contentRect: { width },
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
      flushSync();
    }
  }

  let frameQueue: Map<number, FrameRequestCallback>;
  let nextFrameHandle: number;

  function flushFrames() {
    const callbacks = [...frameQueue.values()];
    frameQueue.clear();
    for (const callback of callbacks) callback(0);
    flushSync();
  }

  beforeEach(() => {
    FakeResizeObserver.instances = [];
    frameQueue = new Map();
    nextFrameHandle = 1;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const handle = nextFrameHandle++;
      frameQueue.set(handle, callback);
      return handle;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
      frameQueue.delete(handle);
    });
    return () => vi.unstubAllGlobals();
  });

  function renderAdaptive(count: number) {
    const view = render(AgentAvatarStack, {
      props: { items: makeItems(count), maxVisible: 3, adaptive: true },
    });
    const observer = FakeResizeObserver.instances.at(-1)!;
    return { view, observer };
  }

  // The stack renders while the +N badge count stays derived from the same
  // slice, so any rendered frame — transient or settled — is self-consistent.
  function expectBadgeConsistent(container: HTMLElement, total: number) {
    const visible = visibleKeys(container).length;
    expect(overflowText(container)).toBe(visible < total ? `+${total - visible}` : null);
  }

  it('renders maxVisible items until the deferred width applies one frame later', () => {
    const { view, observer } = renderAdaptive(12);
    expect(visibleKeys(view.container)).toHaveLength(3);
    expectBadgeConsistent(view.container, 12);

    // A collapsing width makes the pre- and post-application frames
    // distinguishable, proving the delivery is deferred rather than
    // applied synchronously.
    observer.deliver(10);
    // Delivered but not yet applied: still the pre-measurement default.
    expect(visibleKeys(view.container)).toHaveLength(3);
    expect(overflowText(view.container)).toBe('+9');
    flushFrames();
    expect(visibleKeys(view.container)).toHaveLength(0);
    expect(overflowText(view.container)).toBe('+12');
  });

  it('collapses to zero items with the full remainder badge when nothing fits', () => {
    const { view, observer } = renderAdaptive(6);
    observer.deliver(10);
    flushFrames();
    expect(visibleKeys(view.container)).toHaveLength(0);
    expect(overflowText(view.container)).toBe('+6');
    expectBadgeConsistent(view.container, 6);
  });

  it('re-expands when a later delivery widens the stack', () => {
    const { view, observer } = renderAdaptive(12);
    observer.deliver(10);
    flushFrames();
    expect(visibleKeys(view.container)).toHaveLength(0);
    expect(overflowText(view.container)).toBe('+12');

    observer.deliver(600);
    flushFrames();
    expect(visibleKeys(view.container)).toHaveLength(3);
    expect(overflowText(view.container)).toBe('+9');
  });

  it('coalesces a burst of deliveries and applies only the latest width', () => {
    const { view, observer } = renderAdaptive(6);
    // The latest width (10, collapsing) must produce a different state from
    // both the first delivery (600 → 3 visible) and the pre-measurement
    // default (3 visible), so retaining anything but the latest fails.
    observer.deliver(600);
    observer.deliver(200);
    observer.deliver(10);
    expect(frameQueue.size).toBe(1);
    flushFrames();
    expect(visibleKeys(view.container)).toHaveLength(0);
    expect(overflowText(view.container)).toBe('+6');
  });

  it('keeps the badge consistent with the slice across every transient state', () => {
    const { view, observer } = renderAdaptive(6);
    for (const width of [600, 10, 120, 600]) {
      observer.deliver(width);
      expectBadgeConsistent(view.container, 6);
      flushFrames();
      expectBadgeConsistent(view.container, 6);
    }
  });

  it('reflects an item-count change while a measured width is in effect', async () => {
    const { view, observer } = renderAdaptive(6);
    observer.deliver(600);
    flushFrames();
    expect(overflowText(view.container)).toBe('+3');
    await view.rerender({ items: makeItems(12), maxVisible: 3, adaptive: true });
    expect(visibleKeys(view.container)).toHaveLength(3);
    expect(overflowText(view.container)).toBe('+9');
  });
});
