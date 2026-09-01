// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  configuredVisualStates,
  exerciseVisualStates,
} from '$lib/components/__tests__/helpers/visual-state-characterization';

import PanelCornerHandle from '../PanelCornerHandle.svelte';
import PanelSplitHandle from '../PanelSplitHandle.svelte';
import { setDraggedPane } from '../panel-drag';

afterEach(() => {
  setDraggedPane(null);
  document.body.classList.remove('panel-resizing');
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('editorial panel resize handles', () => {
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

  it('uses one neutral visual contract across resize implementations', () => {
    const sharedStyles = fs.readFileSync(
      path.resolve(__dirname, '../../../../styles/resize-handles.css'),
      'utf8',
    );
    const implementationPaths = [
      '../../ResizablePanel.svelte',
      '../../ResizablePanelGroup.svelte',
      '../PanelSplitHandle.svelte',
      '../PanelCornerHandle.svelte',
      '../../sidebar-nav/SidebarPanel.svelte',
      '../../../terminal/QuakeTerminalOverlay.svelte',
      '../../../terminal/RootQuakeTerminalOverlay.svelte',
      '../../../terminal/TerminalSidebar.svelte',
      '../../../terminal/SetupScriptBanner.svelte',
      '../../../chat/input/SimpleRichInput.svelte',
    ];

    expect(sharedStyles).toContain('.app-resize-handle');
    expect(sharedStyles).toContain('--resize-handle-idle: hsl(var(--border))');
    expect(sharedStyles).toContain('--resize-handle-active: hsl(var(--muted-foreground) / 0.55)');
    expect(sharedStyles).toContain('opacity: 0');
    expect(sharedStyles).toContain(
      ".app-resize-handle[data-resize-indicator='short']::before {\n  opacity: 0.45;",
    );
    expect(sharedStyles).not.toContain('var(--primary)');
    expect(sharedStyles).not.toContain('var(--ring)');
    implementationPaths.forEach((implementationPath) => {
      expect(fs.readFileSync(path.resolve(__dirname, implementationPath), 'utf8')).toContain(
        'app-resize-handle',
      );
    });
    expect(
      fs.readFileSync(path.resolve(__dirname, '../../sidebar-nav/SidebarPanel.svelte'), 'utf8'),
    ).toContain('data-combined-panel-divider-border');
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
