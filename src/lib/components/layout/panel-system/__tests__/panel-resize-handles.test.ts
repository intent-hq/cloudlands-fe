// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  configuredVisualStates,
  exerciseVisualStates,
} from '$lib/components/__tests__/helpers/visual-state-characterization';
import type { Workspace, WorkspaceId } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import { store as appStore } from '$store/renderer/store';
import { closePanel, openPanel } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import {
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';

import PanelCornerHandle from '../PanelCornerHandle.svelte';
import PanelSplitHandle from '../PanelSplitHandle.svelte';
import { setDraggedPane } from '../panel-drag';
import SidebarPanelHarness from '../../sidebar-nav/__tests__/mocks/SidebarPanelHarness.svelte';

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

afterEach(() => {
  cleanup();
  setDraggedPane(null);
  document.body.classList.remove('panel-resizing');
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('editorial panel resize handles', () => {
  it.each([
    {
      direction: 'horizontal' as const,
      previous: 'ArrowLeft',
      next: 'ArrowRight',
      ignored: 'ArrowUp',
    },
    {
      direction: 'vertical' as const,
      previous: 'ArrowUp',
      next: 'ArrowDown',
      ignored: 'ArrowLeft',
    },
  ])(
    'commits keyboard resize only along the $direction axis',
    async ({ direction, previous, next, ignored }) => {
      const calls: (string | number)[] = [];
      const view = render(PanelSplitHandle, {
        props: {
          direction,
          onResizeStart: () => calls.push('start'),
          onResize: (delta) => calls.push(delta),
          onResizeEnd: () => calls.push('end'),
        },
      });
      const handle = view.getByRole('button', { name: 'Resize panel' });
      await fireEvent.keyDown(handle, { key: previous });
      await fireEvent.keyDown(handle, { key: next, shiftKey: true });
      await fireEvent.keyDown(handle, { key: ignored });
      await fireEvent.keyDown(handle, { key: next, metaKey: true });
      expect(calls).toEqual(['start', -10, 'end', 'start', 20, 'end']);
      expect(document.body.classList.contains('panel-resizing')).toBe(false);
    },
  );

  const tabDataTransfer = {
    types: ['application/x-panel-tab'],
    getData: () => JSON.stringify({ tabId: 'tab', panelId: 'source' }),
  };

  it('affirms conditional resize-handle visibility in every required visual state', async () => {
    const observed = await exerciseVisualStates(() => {
      const view = render(PanelSplitHandle, { props: { direction: 'horizontal' } });
      const target = view.getByRole('button', { name: 'Resize panel' });
      return {
        ...view,
        target,
        assertCapability: () => {
          expect(target.classList).toContain('app-resize-handle');
          expect(target.getAttribute('data-resize-axis')).toBe('x');
        },
      };
    });
    expect(observed).toEqual(configuredVisualStates);
  });

  it('uses one neutral visual contract for the shared resize-handle stylesheet', () => {
    const sharedStyles = fs.readFileSync(
      path.resolve(__dirname, '../../../../styles/resize-handles.css'),
      'utf8',
    );

    expect(sharedStyles).toContain('.app-resize-handle');
    expect(sharedStyles).toContain('--resize-handle-idle: hsl(var(--border))');
    expect(sharedStyles).toContain('--resize-handle-active: hsl(var(--muted-foreground) / 0.55)');
    expect(sharedStyles).toContain('opacity: 0');
    expect(sharedStyles).not.toContain('var(--primary)');
    expect(sharedStyles).not.toContain('var(--ring)');
  });

  // The panel-system handles assert their shared-handle class in the tests
  // below. The other implementations assert it from their own rendered output:
  // TerminalSidebar.test.ts, ResizablePanel-handle-hit-area.ct.spec.ts,
  // QuakeTerminalOverlay.test.ts (workspace + root overlays),
  // SetupScriptBanner.test.ts and SimpleRichInput.test.ts.
  // The sidebar's two handles are rendered here.
  it('renders the sidebar width and split handles on the shared resize-handle contract', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
        takeRecords = vi.fn();
      },
    );
    const workspace = {
      id: 'ws-owner' as WorkspaceId,
      title: 'Owner',
      branch: 'main',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatusEnum.Active,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      myRole: 'owner',
    } as Workspace;
    try {
      const { container } = render(SidebarPanelHarness, {
        props: {
          setup: () => {
            appStore.dispatch(replaceWorkspaceList([workspace]));
            appStore.dispatch(setWorkspaceHasLoaded(true));
            appStore.dispatch(openPanel('chief'));
          },
        },
      });

      const widthHandle = container.querySelector<HTMLElement>(
        '[data-testid="width-resize-handle"]',
      )!;
      const splitHandle = container.querySelector<HTMLElement>(
        '[data-testid="split-resize-handle"]',
      )!;
      expect(widthHandle.classList).toContain('app-resize-handle');
      expect(widthHandle.dataset.resizeAxis).toBe('x');
      expect(splitHandle.classList).toContain('app-resize-handle');
      expect(splitHandle.dataset.resizeAxis).toBe('y');
      expect(splitHandle.querySelector('[data-combined-panel-divider-border]')).not.toBeNull();
    } finally {
      cleanup();
      appStore.dispatch(closePanel());
      appStore.dispatch(replaceWorkspaceList([]));
      appStore.dispatch(setWorkspaceHasLoaded(false));
      vi.unstubAllGlobals();
    }
  });

  // Scrollbar/hit-area interplay (the clipped leading strip must let clicks
  // reach a neighboring panel's native scrollbar) is asserted behaviorally in
  // panel-resize-handle-hit-area.ct.spec.ts via document.elementFromPoint.

  it('keeps a vertical 16px resize target while reporting horizontal drag deltas', async () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    let scheduledResize: FrameRequestCallback | undefined;
    const requestFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        scheduledResize = callback;
        return 1;
      });
    render(PanelSplitHandle, {
      props: { direction: 'horizontal', onResize, onResizeEnd },
    });

    const handle = screen.getByRole('button', { name: 'Resize panel' });
    expect(handle.classList).toContain('app-resize-handle');
    expect(handle.getAttribute('data-resize-axis')).toBe('x');

    await fireEvent.mouseDown(handle, { clientX: 20 });
    expect(document.body.classList.contains('panel-resizing')).toBe(true);
    await fireEvent.mouseMove(window, { clientX: 29 });
    await fireEvent.mouseMove(window, { clientX: 34 });
    expect(requestFrame).toHaveBeenCalledOnce();
    expect(onResize).not.toHaveBeenCalled();
    scheduledResize?.(0);
    expect(onResize).toHaveBeenCalledWith(14);
    await fireEvent.mouseUp(window);
    expect(onResizeEnd).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('panel-resizing')).toBe(false);
  });

  it('flushes a frame-coalesced pointer delta before a fast mouse-up commit', async () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame');
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 7);
    render(PanelSplitHandle, {
      props: { direction: 'horizontal', onResize, onResizeEnd },
    });

    const handle = screen.getByRole('button', { name: 'Resize panel' });
    await fireEvent.mouseDown(handle, { clientX: 20 });
    await fireEvent.mouseMove(window, { clientX: 49 });

    expect(onResize).not.toHaveBeenCalled();
    await fireEvent.mouseUp(window);
    expect(cancelFrame).toHaveBeenCalledWith(7);
    expect(onResize).toHaveBeenCalledOnce();
    expect(onResize).toHaveBeenCalledWith(29);
    expect(onResizeEnd).toHaveBeenCalledOnce();
  });

  it('routes handle drops only to fixed horizontal column insertion', async () => {
    const onTabDropToHandle = vi.fn();
    render(PanelSplitHandle, {
      props: { direction: 'horizontal', nodePath: [], onTabDropToHandle },
    });
    const handle = screen.getByRole('button', { name: 'Resize panel' });
    handle.getBoundingClientRect = () => ({ left: 0, top: 0, width: 16, height: 400 }) as DOMRect;

    await fireEvent.dragOver(handle, { clientX: 1, clientY: 1, dataTransfer: tabDataTransfer });
    await fireEvent.drop(handle, { clientX: 1, clientY: 1, dataTransfer: tabDataTransfer });

    expect(onTabDropToHandle).toHaveBeenCalledWith('tab', 'source', [], 'after', 'horizontal');
  });

  it('leaves active-pane insertion to the full-height layout gutters', async () => {
    const onTabDropToHandle = vi.fn();
    setDraggedPane({ tabId: 'tab', panelId: 'source' });
    render(PanelSplitHandle, {
      props: { direction: 'horizontal', nodePath: [], onTabDropToHandle },
    });
    const handle = screen.getByRole('button', { name: 'Resize panel' });

    await fireEvent.dragOver(handle, { clientX: 1, clientY: 1, dataTransfer: tabDataTransfer });
    await fireEvent.drop(handle, { clientX: 1, clientY: 1, dataTransfer: tabDataTransfer });

    expect(onTabDropToHandle).not.toHaveBeenCalled();
  });

  it('does not offer tab drops on a stale vertical split handle', async () => {
    const onTabDropToHandle = vi.fn();
    render(PanelSplitHandle, { props: { direction: 'vertical', onTabDropToHandle } });
    const handle = screen.getByRole('button', { name: 'Resize panel' });
    handle.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 16 }) as DOMRect;

    await fireEvent.dragOver(handle, { clientX: 1, clientY: 1, dataTransfer: tabDataTransfer });
    await fireEvent.drop(handle, { clientX: 1, clientY: 1, dataTransfer: tabDataTransfer });

    expect(onTabDropToHandle).not.toHaveBeenCalled();
  });

  it('reports vertical drag deltas from a horizontal resize target', async () => {
    const onResize = vi.fn();
    render(PanelSplitHandle, { props: { direction: 'vertical', onResize } });

    const handle = screen.getByRole('button', { name: 'Resize panel' });
    await fireEvent.mouseDown(handle, { clientY: 12 });
    await fireEvent.mouseMove(window, { clientY: 19 });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(onResize).toHaveBeenCalledWith(7);
    await fireEvent.mouseUp(window);
  });

  it('preserves two-axis corner resizing and cleanup', async () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    render(PanelCornerHandle, { props: { onResize, onResizeEnd } });

    const handle = screen.getByRole('button', { name: 'Resize panel corner' });
    expect(handle.classList).toContain('app-resize-handle');
    expect(handle.getAttribute('data-resize-axis')).toBe('both');
    await fireEvent.mouseDown(handle, { clientX: 10, clientY: 15 });
    expect(document.body.classList.contains('panel-resizing')).toBe(true);
    await fireEvent.mouseMove(window, { clientX: 16, clientY: 24 });
    expect(onResize).toHaveBeenCalledWith(6, 9);
    await fireEvent.mouseUp(window);
    expect(onResizeEnd).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('panel-resizing')).toBe(false);
  });
});
