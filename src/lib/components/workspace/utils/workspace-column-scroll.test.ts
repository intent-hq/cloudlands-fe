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

    expect(scrollWorkspaceColumnIntoView(container, 'ws-new', 'smooth')).toBe(true);
    expect(column.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
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

    expect(scrollWorkspacePanelIntoView(container, 'ws-new', 'panel-new', 'smooth')).toBe(true);
    expect(panel.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'end',
    });
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

    expect(scrollWorkspacePanelIntoView(container, 'ws-clipped', 'panel-clipped')).toBe(true);
    expect(panel.scrollIntoView).toHaveBeenCalledOnce();
  });

  it('does nothing when a panel is outside the owning workspace', () => {
    const container = document.createElement('div');
    const column = document.createElement('section');
    column.dataset.workspaceColumn = 'ws-other';
    container.append(column);

    expect(scrollWorkspacePanelIntoView(container, 'ws-new', 'panel-new')).toBe(false);
  });
});
