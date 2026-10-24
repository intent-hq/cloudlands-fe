import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHomeDoubleClickOpener } from './home-workspace-opening';

type PressType = 'pointerdown' | 'mousedown' | 'mouseup' | 'click' | 'dblclick';

function mountHome() {
  const root = document.createElement('div');
  const row = document.createElement('div');
  const title = document.createElement('span');
  title.textContent = 'Review open pull requests';
  const menu = document.createElement('button');
  row.append(title, menu);
  const preview = document.createElement('div');
  const previewButton = document.createElement('button');
  preview.append(previewButton);
  root.append(row, preview);
  document.body.append(root);
  return { root, row, title, menu, previewButton };
}

const press = (target: Element, type: PressType, init: MouseEventInit = {}) => {
  const Ctor = type === 'pointerdown' && 'PointerEvent' in window ? PointerEvent : MouseEvent;
  const event = new Ctor(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 10,
    clientY: 10,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};

const modifier = () =>
  navigator.platform.toUpperCase().includes('MAC') ? { metaKey: true } : { ctrlKey: true };

function setup() {
  const dom = mountHome();
  const onopen = vi.fn();
  const opener = createHomeDoubleClickOpener(onopen);
  const cleanup = opener.listen(dom.root);
  const rowClicks = vi.fn();
  const previewClicks = vi.fn();
  const previewPointerDowns = vi.fn();
  const documentMouseUps = vi.fn();
  dom.row.addEventListener('click', (event) => {
    rowClicks(event.detail);
    opener.arm(event, 'ws-1');
  });
  dom.previewButton.addEventListener('click', previewClicks);
  dom.previewButton.addEventListener('pointerdown', previewPointerDowns);
  document.addEventListener('mouseup', documentMouseUps);
  return {
    ...dom,
    onopen,
    opener,
    cleanup,
    rowClicks,
    previewClicks,
    previewPointerDowns,
    documentMouseUps,
  };
}

function firstClick(target: Element, init: MouseEventInit = {}) {
  for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click'] as const)
    press(target, type, { detail: type === 'pointerdown' ? 0 : 1, ...init });
}

function secondClick(target: Element, init: MouseEventInit = {}) {
  return (['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick'] as const).map((type) =>
    press(target, type, { detail: type === 'pointerdown' ? 0 : 2, ...init }),
  );
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('createHomeDoubleClickOpener', () => {
  it('opens on the repeat click of a double-click on the row and keeps it from the row', () => {
    const { title, onopen, rowClicks } = setup();
    firstClick(title);
    const [, mousedown, , click, dblclick] = secondClick(title);
    expect(onopen).toHaveBeenCalledExactlyOnceWith('ws-1');
    expect(rowClicks.mock.calls).toEqual([[1]]);
    expect([mousedown, click, dblclick].every((event) => event.defaultPrevented)).toBe(true);
  });

  it('opens when the first click swapped the row for a preview under the cursor', () => {
    const { title, previewButton, onopen, previewClicks, previewPointerDowns } = setup();
    firstClick(title);
    secondClick(previewButton);
    expect(onopen).toHaveBeenCalledExactlyOnceWith('ws-1');
    expect(previewClicks).not.toHaveBeenCalled();
    expect(previewPointerDowns).not.toHaveBeenCalled();
  });

  it('lets the repeat mouseup reach document listeners', () => {
    const { title, documentMouseUps } = setup();
    firstClick(title);
    secondClick(title);
    expect(documentMouseUps).toHaveBeenCalledTimes(2);
  });

  it('ignores a repeat press that lands away from the first click', () => {
    const { title, previewButton, onopen, previewClicks, previewPointerDowns } = setup();
    firstClick(title);
    secondClick(previewButton, { clientX: 200, clientY: 200 });
    expect(onopen).not.toHaveBeenCalled();
    expect(previewClicks).toHaveBeenCalledOnce();
    expect(previewPointerDowns).toHaveBeenCalledOnce();
  });

  it('tolerates a slightly moved second press', () => {
    const { title, onopen } = setup();
    firstClick(title);
    secondClick(title, { clientX: 20, clientY: 18 });
    expect(onopen).toHaveBeenCalledOnce();
  });

  it('does not arm on a nested control or a non-primary button', () => {
    const { title, menu, onopen, rowClicks } = setup();
    firstClick(menu);
    secondClick(menu);
    firstClick(title, { button: 1 });
    secondClick(title, { button: 1 });
    expect(onopen).not.toHaveBeenCalled();
    expect(rowClicks.mock.calls).toEqual([[1], [2], [1], [2]]);
  });

  it('swallows, without opening, the repeat press of a Cmd/Ctrl or Shift double-click', () => {
    const { title, onopen, rowClicks } = setup();
    for (const init of [modifier(), { shiftKey: true }]) {
      firstClick(title, init);
      const [, mousedown] = secondClick(title, init);
      expect(mousedown.defaultPrevented).toBe(true);
    }
    expect(onopen).not.toHaveBeenCalled();
    expect(rowClicks.mock.calls).toEqual([[1], [1]]);
  });

  it('opens once for a triple click and re-arms after a fresh click', () => {
    const { title, onopen } = setup();
    firstClick(title);
    secondClick(title);
    for (const type of ['mousedown', 'mouseup', 'click'] as const)
      press(title, type, { detail: 3 });
    expect(onopen).toHaveBeenCalledOnce();
    firstClick(title);
    secondClick(title);
    expect(onopen).toHaveBeenCalledTimes(2);
  });

  it('is disarmed by an unrelated fresh press before the repeat', () => {
    const { title, previewButton, onopen } = setup();
    firstClick(title);
    press(previewButton, 'mousedown', { detail: 1, clientX: 300 });
    secondClick(title);
    expect(onopen).not.toHaveBeenCalled();
  });

  it('stops listening after cleanup', () => {
    const { title, onopen, cleanup } = setup();
    cleanup();
    firstClick(title);
    secondClick(title);
    expect(onopen).not.toHaveBeenCalled();
  });
});
