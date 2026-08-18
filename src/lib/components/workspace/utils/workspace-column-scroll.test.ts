import { describe, expect, it, vi } from 'vitest';
import {
  scrollWorkspaceColumnIntoView,
  scrollWorkspacePanelIntoView,
} from './workspace-column-scroll';

function setHorizontalRect(element: HTMLElement, left: number, right: number) {
  element.getBoundingClientRect = vi.fn(() => ({ left, right }) as DOMRect);
}

describe('scrollWorkspaceColumnIntoView', () => {
  it('scrolls the matching workspace column to the nearest horizontal edge', () => {
    const container = document.createElement('div');
    const column = document.createElement('section');
    column.dataset.workspaceColumn = 'ws-new';
    column.scrollIntoView = vi.fn();
    container.append(column);
    setHorizontalRect(container, 0, 500);
    setHorizontalRect(column, 600, 900);
    container.scrollTop = 37;

    expect(scrollWorkspaceColumnIntoView(container, 'ws-new', 'auto')).toBe(true);
    expect(container.scrollLeft).toBe(400);
    expect(container.scrollTop).toBe(37);
    expect(column.scrollIntoView).not.toHaveBeenCalled();
  });

  it('does not move the scroller when the workspace is already visible', () => {
    const container = document.createElement('div');
    const column = document.createElement('section');
    column.dataset.workspaceColumn = 'ws-visible';
    column.scrollIntoView = vi.fn();
    container.append(column);
    setHorizontalRect(container, 0, 500);
    setHorizontalRect(column, 100, 300);

    expect(scrollWorkspaceColumnIntoView(container, 'ws-visible', 'smooth')).toBe(false);
    expect(column.scrollIntoView).not.toHaveBeenCalled();
  });

  it('smoothly aligns a visible workspace to the horizontal start with controlled timing', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const container = document.createElement('div');
    const column = document.createElement('section');
    column.dataset.workspaceColumn = 'ws-visible';
    container.append(column);
    setHorizontalRect(container, 0, 500);
    setHorizontalRect(column, 200, 450);
    Object.defineProperty(container, 'scrollLeft', {
      configurable: true,
      value: 100,
      writable: true,
    });

    expect(scrollWorkspaceColumnIntoView(container, 'ws-visible', 'smooth', 'start')).toBe(true);
    expect(frames).toHaveLength(1);
    frames.shift()?.(0);
    frames.shift()?.(180);
    expect(container.scrollLeft).toBeGreaterThan(100);
    expect(container.scrollLeft).toBeLessThan(300);
    frames.shift()?.(360);
    expect(container.scrollLeft).toBe(300);

    vi.unstubAllGlobals();
  });

  it('keeps start-aligned workspace chrome inside the configured scroll padding', () => {
    const container = document.createElement('div');
    const column = document.createElement('section');
    column.dataset.workspaceColumn = 'ws-padded';
    container.dataset.workspaceRevealInset = '8';
    container.style.scrollPaddingInline = '8px';
    container.append(column);
    setHorizontalRect(container, 0, 500);
    setHorizontalRect(column, 200, 450);
    container.scrollLeft = 100;

    expect(scrollWorkspaceColumnIntoView(container, 'ws-padded', 'auto', 'start')).toBe(true);
    expect(container.scrollLeft).toBe(292);
  });

  it('does nothing when the workspace column has not rendered', () => {
    const container = document.createElement('div');

    expect(scrollWorkspaceColumnIntoView(container, 'ws-missing', 'smooth')).toBe(false);
  });

  it('reveals a panel at the horizontal end of its owning workspace', () => {
    const container = document.createElement('div');
    const column = document.createElement('section');
    const panel = document.createElement('div');
    column.dataset.workspaceColumn = 'ws-new';
    panel.dataset.panelId = 'panel-new';
    panel.scrollIntoView = vi.fn();
    column.append(panel);
    container.append(column);
    setHorizontalRect(container, 0, 500);
    setHorizontalRect(panel, 600, 900);
    container.scrollTop = 29;

    expect(scrollWorkspacePanelIntoView(container, 'ws-new', 'panel-new', 'auto')).toBe(true);
    expect(container.scrollLeft).toBe(400);
    expect(container.scrollTop).toBe(29);
    expect(panel.scrollIntoView).not.toHaveBeenCalled();
  });

  it('converts visual geometry to layout scroll units at 200% CSS zoom', () => {
    const container = document.createElement('div');
    const column = document.createElement('section');
    const panel = document.createElement('div');
    column.dataset.workspaceColumn = 'ws-zoomed';
    panel.dataset.panelId = 'panel-zoomed';
    column.append(panel);
    container.append(column);
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 500 });
    setHorizontalRect(container, 0, 1000);
    setHorizontalRect(panel, 1200, 1800);

    expect(scrollWorkspacePanelIntoView(container, 'ws-zoomed', 'panel-zoomed')).toBe(true);
    expect(container.scrollLeft).toBe(400);
  });

  it('scales scroll padding with the visual viewport at 200% CSS zoom', () => {
    const container = document.createElement('div');
    const column = document.createElement('section');
    column.dataset.workspaceColumn = 'ws-zoomed';
    container.dataset.workspaceRevealInset = '8';
    container.style.scrollPaddingInline = '8px';
    container.append(column);
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 500 });
    setHorizontalRect(container, 0, 1000);
    setHorizontalRect(column, 1200, 1800);

    expect(scrollWorkspaceColumnIntoView(container, 'ws-zoomed', 'auto', 'start')).toBe(true);
    expect(container.scrollLeft).toBe(592);
  });

  it('reveals a partly clipped panel inside both scroll-padding edges', () => {
    const container = document.createElement('div');
    const column = document.createElement('section');
    const panel = document.createElement('div');
    column.dataset.workspaceColumn = 'ws-padded';
    panel.dataset.panelId = 'panel-padded';
    container.dataset.workspaceRevealInset = '8';
    container.style.scrollPaddingInline = '8px';
    column.append(panel);
    container.append(column);
    setHorizontalRect(container, 0, 500);
    setHorizontalRect(panel, 200, 496);
    container.scrollLeft = 100;

    expect(scrollWorkspacePanelIntoView(container, 'ws-padded', 'panel-padded')).toBe(true);
    expect(container.scrollLeft).toBe(104);
  });

  it('does not move the scroller when the panel is already visible', () => {
    const container = document.createElement('div');
    const column = document.createElement('section');
    const panel = document.createElement('div');
    column.dataset.workspaceColumn = 'ws-visible';
    panel.dataset.panelId = 'panel-visible';
    panel.scrollIntoView = vi.fn();
    column.append(panel);
    container.append(column);
    setHorizontalRect(container, 0, 500);
    setHorizontalRect(panel, 200, 450);

    expect(scrollWorkspacePanelIntoView(container, 'ws-visible', 'panel-visible')).toBe(false);
    expect(panel.scrollIntoView).not.toHaveBeenCalled();
  });

  it('cancels an older smooth reveal when the newly focused panel is already visible', () => {
    const frames: FrameRequestCallback[] = [];
    const cancelFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    const container = document.createElement('div');
    const column = document.createElement('section');
    const oldTarget = document.createElement('div');
    const focusedPanel = document.createElement('div');
    column.dataset.workspaceColumn = 'ws-focus';
    oldTarget.dataset.panelId = 'panel-old';
    focusedPanel.dataset.panelId = 'panel-focused';
    column.append(oldTarget, focusedPanel);
    container.append(column);
    setHorizontalRect(container, 0, 500);
    setHorizontalRect(oldTarget, 600, 900);
    setHorizontalRect(focusedPanel, 100, 400);

    expect(scrollWorkspacePanelIntoView(container, 'ws-focus', 'panel-old', 'smooth')).toBe(true);
    expect(scrollWorkspacePanelIntoView(container, 'ws-focus', 'panel-focused', 'smooth')).toBe(
      false,
    );
    expect(cancelFrame).toHaveBeenCalledWith(1);

    vi.unstubAllGlobals();
  });

  it.each([
    ['left', -50, 300],
    ['right', 200, 550],
  ])('reveals a panel that is partly clipped on the %s', (_side, left, right) => {
    const container = document.createElement('div');
    const column = document.createElement('section');
    const panel = document.createElement('div');
    column.dataset.workspaceColumn = 'ws-clipped';
    panel.dataset.panelId = 'panel-clipped';
    panel.scrollIntoView = vi.fn();
    column.append(panel);
    container.append(column);
    setHorizontalRect(container, 0, 500);
    setHorizontalRect(panel, left, right);
    container.scrollLeft = 100;

    expect(scrollWorkspacePanelIntoView(container, 'ws-clipped', 'panel-clipped')).toBe(true);
    expect(container.scrollLeft).toBe(_side === 'left' ? 50 : 150);
    expect(panel.scrollIntoView).not.toHaveBeenCalled();
  });

  it('does nothing when a panel is outside the owning workspace', () => {
    const container = document.createElement('div');
    const column = document.createElement('section');
    column.dataset.workspaceColumn = 'ws-other';
    container.append(column);

    expect(scrollWorkspacePanelIntoView(container, 'ws-new', 'panel-new')).toBe(false);
  });
});
