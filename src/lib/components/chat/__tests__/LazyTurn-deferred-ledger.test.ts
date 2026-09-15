/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LazyTurn from '../LazyTurn.svelte';
import { createLazyTurnHeightCache } from '../lazy-turn-height-cache';
import * as ledgerModule from '../lazy-turn-scroll-ledger';

vi.mock('svelte', async (importOriginal) => {
  const actual = await importOriginal<typeof import('svelte')>();
  return { ...actual, tick: vi.fn(actual.tick) };
});

describe('LazyTurn deferred scroll compensation', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let notifyIntersection: (visible: boolean) => void;

  const flushFrame = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(performance.now()));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    frames = new Map();
    nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          notifyIntersection = (isIntersecting) =>
            callback(
              [{ target: this.target, isIntersecting } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            );
        }
        target!: Element;
        observe(target: Element) {
          this.target = target;
        }
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(['active', 'inactive', 'reactivated', 'unmounted'] as const)(
    'handles a delayed swap tick when the row is %s',
    async (lifecycle) => {
      let rowHeight = 240;
      let scrollHeight = 2000;
      const scroller = document.createElement('div');
      document.body.append(scroller);
      Object.defineProperties(scroller, {
        scrollHeight: { get: () => scrollHeight },
        clientHeight: { get: () => 500 },
      });
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
        return this.classList.contains('lazy-turn') ? rowHeight : 0;
      });
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(640);
      const createLedger = ledgerModule.createHeightLedger;
      const request = vi.fn();
      vi.spyOn(ledgerModule, 'createHeightLedger').mockImplementation((...args) => {
        const ledger = createLedger(...args);
        const originalRequest = ledger.request;
        ledger.request = (...requestArgs) => {
          request(...requestArgs);
          originalRequest(...requestArgs);
        };
        return ledger;
      });
      const props = {
        turnKey: 'delayed-row',
        heightCache: createLazyTurnHeightCache('deferred-ledger'),
        scrollRoot: scroller,
        isActive: true,
        children: createRawSnippet(() => ({ render: () => '<div>row</div>' })),
      };
      props.heightCache.set('delayed-row', 240, 640);
      const view = render(LazyTurn, { target: scroller, props });
      let unmounted = false;
      try {
        const row = scroller.querySelector<HTMLElement>('.lazy-turn')!;
        vi.spyOn(row, 'getBoundingClientRect').mockImplementation(
          () => ({ top: -500, bottom: -500 + rowHeight, height: rowHeight }) as DOMRect,
        );
        await tick();
        flushFrame();
        await vi.advanceTimersByTimeAsync(0);
        notifyIntersection(false);
        await vi.advanceTimersByTimeAsync(250);
        await tick();
        flushFrame();
        expect(row.dataset.lazyVisible).toBe('false');
        request.mockClear();
        scroller.scrollTop = 1200;

        let releaseTick!: () => void;
        vi.mocked(tick).mockReturnValueOnce(
          new Promise<void>((resolve) => {
            releaseTick = resolve;
          }),
        );
        notifyIntersection(true);
        expect(request).not.toHaveBeenCalled();
        rowHeight = 400;
        scrollHeight += 160;
        if (lifecycle === 'inactive' || lifecycle === 'reactivated') {
          await view.rerender({ ...props, isActive: false });
        }
        if (lifecycle === 'reactivated') await view.rerender(props);
        if (lifecycle === 'unmounted') {
          view.unmount();
          unmounted = true;
        }
        flushFrame();
        releaseTick();
        await tick();
        flushFrame();

        expect(request).toHaveBeenCalledTimes(lifecycle === 'active' ? 1 : 0);
        if (lifecycle === 'active') {
          expect(request).toHaveBeenCalledWith({
            scrollTop: 1200,
            scrollHeight: 2000,
            clientHeight: 500,
          });
        }
        expect(scroller.scrollTop).toBe(lifecycle === 'active' ? 1360 : 1200);
      } finally {
        if (!unmounted) view.unmount();
        scroller.remove();
      }
    },
  );
});
