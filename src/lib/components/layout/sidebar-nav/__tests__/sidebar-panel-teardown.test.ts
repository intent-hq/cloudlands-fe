/**
 * Regression tests: SidebarPanel drag teardown.
 *
 * The panel's width-drag handlers add global window listeners
 * and body classes. On unmount mid-drag, the component must remove all
 * listeners, cancel any pending RAF, and clear body classes to prevent leaks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { store as appStore } from '$store/renderer/store';
import {
  openPanel,
  closePanel,
  setPanelWidth,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import SidebarPanelHarness from './mocks/SidebarPanelHarness.svelte';

vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    fetchActiveStreams: vi.fn(),
    startPolling: vi.fn(),
    getStreamingAgentIdsForWorkspace: vi.fn(() => []),
    subscribe: vi.fn(() => () => {}),
  },
}));

vi.mock('$lib/electron-bridge', () => ({
  on: vi.fn(),
  off: vi.fn(),
  once: vi.fn(),
  invoke: vi.fn(),
  listenSync: vi.fn(),
}));

describe('SidebarPanel teardown', () => {
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let cancelAnimationFrameSpy: ReturnType<typeof vi.spyOn>;
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame');
    requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation(() => 123);

    // Mock ResizeObserver and MutationObserver
    global.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    } as any;
    global.MutationObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn();
    } as any;
  });

  afterEach(() => {
    cleanup();
    removeEventListenerSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
    requestAnimationFrameSpy.mockRestore();
    document.body.classList.remove('panel-resizing');
    appStore.dispatch(closePanel());
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does not overwrite the latest pointer width with a queued Redux width echo', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    let nextFrameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    requestAnimationFrameSpy.mockImplementation((callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    });
    cancelAnimationFrameSpy.mockImplementation((id: number) => frames.delete(id));
    async function flushFrame() {
      await vi.advanceTimersByTimeAsync(20);
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(Date.now());
      await tick();
    }
    const { container } = render(SidebarPanelHarness, {
      setup: () => {
        appStore.dispatch(setPanelWidth(288));
        appStore.dispatch(openPanel('all-workspaces'));
      },
    });
    await flushFrame();
    const handle = container.querySelector('[data-testid="width-resize-handle"]')!;
    await fireEvent.mouseDown(handle, { clientX: 288 });
    await fireEvent.mouseMove(window, { clientX: 201 });
    await flushFrame();
    await fireEvent.mouseMove(window, { clientX: 180 });
    // The next frame delivers the cadenced selector echo from the previous move.
    await flushFrame();
    await fireEvent.mouseUp(window, { clientX: 180 });
    await flushFrame();
    expect(appStore.state.sidebarNav.panelWidth).toBe(180);
    expect(container.querySelector('[role="tablist"]')?.getAttribute('aria-orientation')).toBe(
      'vertical',
    );
  });

  it('cleans up tabbed sidebar width-drag listeners and body class on unmount mid-drag', async () => {
    const { container } = render(SidebarPanelHarness, {
      props: {
        setup: () => {
          appStore.dispatch(openPanel('chief'));
        },
      },
    });

    const widthHandle = container.querySelector('[data-testid="width-resize-handle"]');
    expect(widthHandle).not.toBeNull();

    await fireEvent.mouseDown(widthHandle!, { clientX: 100 });
    expect(document.body.classList.contains('panel-resizing')).toBe(true);

    // Unmount mid-drag (before mouseup)
    cleanup();

    // Body class must be removed
    expect(document.body.classList.contains('panel-resizing')).toBe(false);
    // Listeners must be removed
    expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
  });

  it('subsequent window mousemove after unmount does not throw or dispatch', async () => {
    const dispatchSpy = vi.spyOn(appStore, 'dispatch');
    const { container } = render(SidebarPanelHarness, {
      props: {
        setup: () => {
          appStore.dispatch(openPanel('chief'));
        },
      },
    });

    const widthHandle = container.querySelector('[data-testid="width-resize-handle"]');
    await fireEvent.mouseDown(widthHandle!, { clientX: 100 });

    cleanup();
    dispatchSpy.mockClear();

    // Fire global mousemove after unmount - should not dispatch
    await fireEvent.mouseMove(window, { clientX: 150, clientY: 150 });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('cleans up width-drag listeners and body class on unmount mid-drag', async () => {
    const { container } = render(SidebarPanelHarness, {
      props: {
        setup: () => {
          appStore.dispatch(openPanel('active'));
        },
      },
    });

    const widthHandle = container.querySelector('[data-testid="width-resize-handle"]');
    expect(widthHandle).not.toBeNull();

    // Start width drag
    await fireEvent.mouseDown(widthHandle!, { clientX: 300 });
    expect(document.body.classList.contains('panel-resizing')).toBe(true);

    // Unmount mid-drag
    cleanup();

    // Body class must be removed
    expect(document.body.classList.contains('panel-resizing')).toBe(false);
    // Listeners must be removed
    expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
  });

  it('cancels pending RAF on unmount during width resize', async () => {
    const { container } = render(SidebarPanelHarness, {
      props: {
        setup: () => {
          appStore.dispatch(openPanel('active'));
        },
      },
    });

    const widthHandle = container.querySelector('[data-testid="width-resize-handle"]');
    await fireEvent.mouseDown(widthHandle!, { clientX: 300 });

    // Trigger mousemove to queue RAF
    await fireEvent.mouseMove(window, { clientX: 350 });

    // RAF should have been called
    expect(requestAnimationFrameSpy).toHaveBeenCalled();

    // Unmount before RAF fires
    cleanup();

    // cancelAnimationFrame should have been called
    expect(cancelAnimationFrameSpy).toHaveBeenCalled();
  });

  it('subsequent window mouseup after unmount does not throw or dispatch', async () => {
    const dispatchSpy = vi.spyOn(appStore, 'dispatch');
    const { container } = render(SidebarPanelHarness, {
      props: {
        setup: () => {
          appStore.dispatch(openPanel('active'));
        },
      },
    });

    const widthHandle = container.querySelector('[data-testid="width-resize-handle"]');
    await fireEvent.mouseDown(widthHandle!, { clientX: 300 });

    cleanup();
    dispatchSpy.mockClear();

    // Fire global mouseup after unmount - should not dispatch
    await fireEvent.mouseUp(window);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
