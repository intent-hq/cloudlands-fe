/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  sidebarCollapsedInitial: false,
  setSidebarCollapsed: (_collapsed: boolean) => {},
  storedPanelSizeSetters: new Map<string, (value: number | undefined) => void>(),
}));

vi.mock('$store/renderer/store', () => ({ store: { dispatch: mocks.dispatch } }));
vi.mock('$store/renderer/slices/ui-layout/ui-layout-selectors', async () => {
  const { readable } = await import('svelte/store');
  return {
    selectIsCollapsed: () =>
      readable(mocks.sidebarCollapsedInitial, (set) => {
        mocks.setSidebarCollapsed = set;
        return () => (mocks.setSidebarCollapsed = () => {});
      }),
    selectSidebarWidth: () => readable(360),
    selectSidebarExpandedWidth: () => readable(600),
    selectResizablePanelSize: (storageKey: string) => {
      const initialValue =
        storageKey === 'panel-canvas-width:synced'
          ? 600
          : storageKey === 'panel-canvas-width:hydrated'
            ? 1320
            : storageKey === 'workspace-left-panel-width:valid'
              ? 390
              : storageKey === 'workspace-left-panel-width:stale'
                ? 720
                : storageKey === 'workspace-left-panel-expanded-width:stale'
                  ? 880
                  : undefined;
      return readable(initialValue, (set) => {
        mocks.storedPanelSizeSetters.set(storageKey, set);
        return () => mocks.storedPanelSizeSetters.delete(storageKey);
      });
    },
    selectResizablePanelSizeHydrated: (storageKey: string) =>
      readable(storageKey !== 'workspace-left-panel-width:delayed'),
  };
});

import ResizablePanel from './ResizablePanel.svelte';

afterEach(() => {
  cleanup();
  mocks.dispatch.mockClear();
  mocks.sidebarCollapsedInitial = false;
  mocks.storedPanelSizeSetters.clear();
  vi.restoreAllMocks();
});

describe('ResizablePanel reactive defaults', () => {
  it('collapses and restores a workspace sidebar with scoped storage keys', async () => {
    const { container } = render(ResizablePanel, {
      props: {
        storageKey: 'workspace-left-panel-width:ws-1',
        expandedStorageKey: 'workspace-left-panel-expanded-width:ws-1',
        defaultWidth: 360,
      },
    });
    const panel = container.firstElementChild;

    expect(panel?.getAttribute('style')).toContain('width: 360px');
    await tick();
    mocks.setSidebarCollapsed(true);
    await waitFor(() => expect(panel?.getAttribute('style')).toContain('width: 0px'));
    expect(panel?.getAttribute('style')).toContain('min-width: 0px');

    mocks.setSidebarCollapsed(false);
    await waitFor(() => expect(panel?.getAttribute('style')).toContain('width: 360px'));
  });

  it('stays collapsed when a stored sidebar width hydrates and restores it on expand', async () => {
    mocks.sidebarCollapsedInitial = true;
    const storageKey = 'workspace-left-panel-width:delayed';
    const { container } = render(ResizablePanel, {
      props: { storageKey, defaultWidth: 360 },
    });
    const panel = container.firstElementChild;

    await waitFor(() => expect(panel?.getAttribute('style')).toContain('width: 0px'));
    mocks.storedPanelSizeSetters.get(storageKey)?.(390);
    await tick();
    expect(panel?.getAttribute('style')).toContain('width: 0px');

    mocks.setSidebarCollapsed(false);
    await waitFor(() => expect(panel?.getAttribute('style')).toContain('width: 390px'));
  });

  it('does not notify again when only the callback identity changes', async () => {
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const props = { defaultWidth: 480, onWidthChange: firstCallback };
    const { rerender } = render(ResizablePanel, { props });

    await waitFor(() => expect(firstCallback).toHaveBeenCalledWith(480));
    await rerender({ ...props, onWidthChange: secondCallback });
    await tick();

    expect(firstCallback).toHaveBeenCalledOnce();
    expect(secondCallback).not.toHaveBeenCalled();
  });

  it('grows to an increased default without shrinking an existing width', async () => {
    const props = {
      storageKey: 'panel-canvas-width:ws-1',
      minWidth: 640,
      maxWidth: 2200,
      defaultWidth: 960,
      growWithDefaultWidth: true,
    };
    const { container, rerender } = render(ResizablePanel, { props });

    expect(container.firstElementChild?.getAttribute('style')).toContain('width: 960px');
    await rerender({ ...props, defaultWidth: 1560 });

    await waitFor(() => {
      expect(container.firstElementChild?.getAttribute('style')).toContain('width: 1560px');
    });
    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'uiLayout/setResizablePanelSize',
      payload: ['panel-canvas-width:ws-1', 1560],
    });
  });

  it('resizes in both directions by the reactive default delta', async () => {
    const props = {
      storageKey: 'panel-canvas-width:ws-1',
      minWidth: 280,
      maxWidth: 960,
      defaultWidth: 360,
      resizeWithDefaultWidth: true,
    };
    const { container, rerender } = render(ResizablePanel, { props });

    expect(container.firstElementChild?.className).toContain(
      'transition-[width,min-width,max-width]',
    );
    expect(container.firstElementChild?.getAttribute('style')).toContain('min-width: 280px');

    await rerender({ ...props, maxWidth: 1600, defaultWidth: 960 });
    await waitFor(() => {
      expect(container.firstElementChild?.getAttribute('style')).toContain('width: 960px');
    });
    expect(container.firstElementChild?.getAttribute('style')).toContain('min-width: 280px');
    expect(container.firstElementChild?.getAttribute('style')).toContain('max-width: 1600px');

    await rerender(props);
    await waitFor(() => {
      expect(container.firstElementChild?.getAttribute('style')).toContain('width: 360px');
    });
    expect(container.firstElementChild?.getAttribute('style')).toContain('min-width: 280px');
    expect(container.firstElementChild?.getAttribute('style')).toContain('max-width: 960px');
  });

  it('applies and removes a transient width delta without persisting it', async () => {
    const props = {
      storageKey: 'panel-canvas-width:ws-1',
      minWidth: 280,
      maxWidth: 2200,
      defaultWidth: 1320,
      transientWidthDelta: 0,
    };
    const { container, rerender } = render(ResizablePanel, { props });
    mocks.dispatch.mockClear();

    await rerender({ ...props, transientWidthDelta: -480 });
    expect(container.firstElementChild?.getAttribute('style')).toContain('width: 840px');
    expect(mocks.dispatch).not.toHaveBeenCalled();

    await rerender(props);
    expect(container.firstElementChild?.getAttribute('style')).toContain('width: 1320px');
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('does not apply a restored panel-count delta twice during hydration', async () => {
    const initialProps = {
      storageKey: 'panel-canvas-width:hydrated',
      minWidth: 280,
      maxWidth: 1960,
      defaultWidth: 360,
      resizeWithDefaultWidth: false,
    };
    const { container, rerender } = render(ResizablePanel, { props: initialProps });

    await waitFor(() => {
      expect(container.firstElementChild?.getAttribute('style')).toContain('width: 1320px');
    });
    await rerender({ ...initialProps, defaultWidth: 1320, resizeWithDefaultWidth: true });
    expect(container.firstElementChild?.getAttribute('style')).toContain('width: 1320px');

    await rerender({ ...initialProps, defaultWidth: 1800, resizeWithDefaultWidth: true });
    await waitFor(() => {
      expect(container.firstElementChild?.getAttribute('style')).toContain('width: 1800px');
    });
  });

  it('starts from and follows the default when persisted width restoration is disabled', async () => {
    const props = {
      storageKey: 'panel-canvas-width:hydrated',
      minWidth: 280,
      maxWidth: 1960,
      defaultWidth: 960,
      restoreStoredWidth: false,
      resizeWithDefaultWidth: false,
    };
    const { container, rerender } = render(ResizablePanel, { props });

    expect(container.firstElementChild?.getAttribute('style')).toContain('width: 960px');
    expect(mocks.dispatch).not.toHaveBeenCalledWith({
      type: 'uiLayout/requestResizablePanelSize',
      payload: ['panel-canvas-width:hydrated'],
    });

    await rerender({ ...props, defaultWidth: 1320, resizeWithDefaultWidth: true });
    await waitFor(() => {
      expect(container.firstElementChild?.getAttribute('style')).toContain('width: 1320px');
    });
  });

  it('syncs exactly to a reactive default after a stored manual width', async () => {
    const props = {
      storageKey: 'panel-canvas-width:synced',
      minWidth: 280,
      maxWidth: 960,
      defaultWidth: 360,
      syncWithDefaultWidth: true,
    };
    const { container, rerender } = render(ResizablePanel, { props });

    await waitFor(() => {
      expect(container.firstElementChild?.getAttribute('style')).toContain('width: 600px');
    });
    await rerender({ ...props, maxWidth: 1600, defaultWidth: 960 });

    await waitFor(() => {
      expect(container.firstElementChild?.getAttribute('style')).toContain('width: 960px');
    });
  });

  it('does not apply a direct drag delta again when its committed default catches up', async () => {
    const props = {
      defaultWidth: 1000,
      minWidth: 500,
      maxWidth: 2000,
      side: 'left' as const,
      syncWithDefaultWidth: true,
    };
    const { container, rerender } = render(ResizablePanel, { props });
    const handle = container.querySelector('button')!;

    await fireEvent.mouseDown(handle, { clientX: 1000 });
    await fireEvent.mouseMove(document, { clientX: 1100 });
    await fireEvent.mouseUp(document);
    await rerender({ ...props, defaultWidth: 1100 });

    expect(container.firstElementChild?.getAttribute('style')).toContain('width: 1100px');
  });

  it('can keep width changes instantaneous for nested column sidebars', () => {
    const { container } = render(ResizablePanel, {
      props: { defaultWidth: 360, disableWidthTransition: true },
    });

    expect(container.firstElementChild?.className).not.toContain(
      'transition-[width,min-width,max-width]',
    );
  });

  it('suspends width motion and reports active pointer resizing', async () => {
    const onResizeStart = vi.fn();
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    const { container } = render(ResizablePanel, {
      props: {
        defaultWidth: 360,
        showHandleIndicator: true,
        onResizeStart,
        onResize,
        onResizeEnd,
      },
    });
    const panel = container.firstElementChild!;
    const handle = container.querySelector('button')!;
    expect(handle.dataset.resizeIndicator).toBe('short');

    await fireEvent.mouseDown(handle, { clientX: 360 });
    expect(onResizeStart).toHaveBeenCalledOnce();
    expect(document.body.classList).toContain('panel-resizing');
    expect(panel.className).not.toContain('transition-[width,min-width,max-width]');

    await fireEvent.mouseMove(document, { clientX: 320 });
    expect(onResize).toHaveBeenLastCalledWith(360, 400);

    await fireEvent.mouseUp(document);
    expect(onResizeEnd).toHaveBeenCalledOnce();
    expect(onResizeEnd).toHaveBeenCalledWith(360, 400);
    expect(document.body.classList).not.toContain('panel-resizing');
    expect(panel.className).toContain('transition-[width,min-width,max-width]');
  });

  it('restores the starting width and reports cancellation on Escape', async () => {
    const onResizeCancel = vi.fn();
    const onResizeEnd = vi.fn();
    const { container } = render(ResizablePanel, {
      props: { defaultWidth: 360, onResizeCancel, onResizeEnd },
    });
    const panel = container.firstElementChild!;
    const handle = container.querySelector('button')!;

    await fireEvent.mouseDown(handle, { clientX: 360 });
    await fireEvent.mouseMove(document, { clientX: 320 });
    expect(panel.getAttribute('style')).toContain('width: 400px');

    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(panel.getAttribute('style')).toContain('width: 360px');
    expect(onResizeCancel).toHaveBeenCalledOnce();
    expect(onResizeEnd).not.toHaveBeenCalled();
  });

  it('uses the canonical reset width on handle double-click', async () => {
    const onResizeEnd = vi.fn();
    const { container } = render(ResizablePanel, {
      props: { defaultWidth: 360, resetWidth: 540, maxWidth: 800, onResizeEnd },
    });

    await fireEvent.dblClick(container.querySelector('button')!);

    expect(container.firstElementChild?.getAttribute('style')).toContain('width: 540px');
    expect(onResizeEnd).toHaveBeenCalledWith(360, 540);
  });

  it('includes horizontal scroll distance when enlarging at the viewport edge', async () => {
    const scrollContainer = document.createElement('div');
    scrollContainer.scrollLeft = 100;
    const onResize = vi.fn();
    const { container } = render(ResizablePanel, {
      props: {
        defaultWidth: 360,
        maxWidth: 800,
        side: 'left',
        resizeScrollContainer: scrollContainer,
        onResize,
      },
    });
    const handle = container.querySelector('button')!;

    await fireEvent.mouseDown(handle, { clientX: 500 });
    scrollContainer.scrollLeft = 140;
    await fireEvent.mouseMove(document, { clientX: 500 });

    expect(onResize).toHaveBeenLastCalledWith(360, 400);
    expect(container.firstElementChild?.getAttribute('style')).toContain('width: 400px');
    await fireEvent.mouseUp(document);
  });

  it('auto-scrolls while the resize pointer remains at the right viewport edge', async () => {
    const scrollContainer = document.createElement('div');
    scrollContainer.scrollLeft = 80;
    let resizedWidth = 360;
    Object.defineProperties(scrollContainer, {
      clientWidth: { value: 500 },
      scrollWidth: { get: () => 600 + resizedWidth - 360 },
    });
    scrollContainer.getBoundingClientRect = () => ({ right: 500 }) as DOMRect;
    let frame: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frame = callback;
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const { container } = render(ResizablePanel, {
      props: {
        defaultWidth: 360,
        maxWidth: 800,
        side: 'left',
        resizeScrollContainer: scrollContainer,
        onResize: (_previousWidth: number, nextWidth: number) => (resizedWidth = nextWidth),
      },
    });
    const handle = container.querySelector('button')!;

    await fireEvent.mouseDown(handle, { clientX: 490 });
    await fireEvent.mouseMove(document, { clientX: 499 });
    for (let index = 0; index < 3; index += 1) {
      const nextFrame = frame;
      frame = undefined;
      nextFrame?.(index * 16);
      await tick();
    }

    expect(scrollContainer.scrollLeft).toBe(104);
    expect(container.firstElementChild?.getAttribute('style')).toContain('width: 393px');
    await fireEvent.mouseUp(document);
  });

  it('preserves the rendered fill width when returning to fixed-width mode', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 420,
      height: 0,
      top: 0,
      right: 420,
      bottom: 0,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const onWidthChange = vi.fn();
    const props = { defaultWidth: 360, doSkipResize: true, onWidthChange };
    const { container, rerender } = render(ResizablePanel, { props });

    expect(container.firstElementChild?.getAttribute('style')).toContain('width: 100%');
    await rerender({ ...props, doSkipResize: false });

    await waitFor(() => {
      expect(container.firstElementChild?.getAttribute('style')).toContain('width: 420px');
    });
    expect(onWidthChange).toHaveBeenLastCalledWith(420);
    rect.mockRestore();
  });
});
