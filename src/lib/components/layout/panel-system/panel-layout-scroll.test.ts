import { describe, expect, it, vi } from 'vitest';
import { scrollPanelIntoView } from './panel-layout-scroll';

function setRect(element: HTMLElement, left: number, right: number) {
  element.getBoundingClientRect = vi.fn(() => ({ left, right }) as DOMRect);
}

describe('scrollPanelIntoView', () => {
  it('reveals a focused panel without changing vertical scroll', () => {
    const container = document.createElement('div');
    const panel = document.createElement('section');
    panel.dataset.panelId = 'panel-3';
    container.append(panel);
    setRect(container, 100, 600);
    setRect(panel, 650, 950);
    container.scrollTop = 37;

    expect(scrollPanelIntoView(container, 'panel-3')).toBe(true);
    expect(container.scrollLeft).toBe(350);
    expect(container.scrollTop).toBe(37);
  });

  it('converts visual distance to layout scroll units at 200% zoom', () => {
    const container = document.createElement('div');
    const panel = document.createElement('section');
    panel.dataset.panelId = 'panel-zoomed';
    container.append(panel);
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 500 });
    setRect(container, 0, 1000);
    setRect(panel, 1200, 1800);

    expect(scrollPanelIntoView(container, 'panel-zoomed')).toBe(true);
    expect(container.scrollLeft).toBe(400);
  });

  it('animates a smooth reveal inside the panel viewport', () => {
    const container = document.createElement('div');
    const panel = document.createElement('section');
    panel.dataset.panelId = 'panel-smooth';
    container.append(panel);
    setRect(container, 0, 500);
    setRect(panel, 600, 900);
    container.scrollTop = 23;
    container.scrollTo = vi.fn();

    expect(scrollPanelIntoView(container, 'panel-smooth', 'smooth')).toBe(true);
    expect(container.scrollTo).toHaveBeenCalledWith({ left: 400, top: 23, behavior: 'smooth' });
  });

  it('does not move an already visible panel', () => {
    const container = document.createElement('div');
    const panel = document.createElement('section');
    panel.dataset.panelId = 'panel-visible';
    container.append(panel);
    setRect(container, 0, 500);
    setRect(panel, 100, 400);

    expect(scrollPanelIntoView(container, 'panel-visible')).toBe(false);
    expect(container.scrollLeft).toBe(0);
  });
});
