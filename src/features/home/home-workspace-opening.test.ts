import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHomeDoubleClickOpener, openHomeWorkspaceFromEvent } from './home-workspace-opening';

type PressType = 'mousedown' | 'mouseup' | 'click' | 'dblclick';

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
  const event = new MouseEvent(type, {
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

function setup() {
  const dom = mountHome();
  const onopen = vi.fn();
  const opener = createHomeDoubleClickOpener(onopen);
  const cleanup = opener.listen(dom.root);
  const rowClicks = vi.fn();
  const previewClicks = vi.fn();
  dom.row.addEventListener('click', (event) => {
    rowClicks(event.detail);
    opener.arm(event, 'ws-1');
  });
  dom.previewButton.addEventListener('click', previewClicks);
  return { ...dom, onopen, opener, cleanup, rowClicks, previewClicks };
}

function firstClick(target: Element, init: MouseEventInit = {}) {
  for (const type of ['mousedown', 'mouseup', 'click'] as const)
    press(target, type, { detail: 1, ...init });
}

function secondClick(target: Element, init: MouseEventInit = {}) {
  return (['mousedown', 'mouseup', 'click', 'dblclick'] as const).map((type) =>
    press(target, type, { detail: 2, ...init }),
  );
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('createHomeDoubleClickOpener', () => {
  it('opens on the repeat click of a double-click on the row and keeps it from the row', () => {
    const { title, onopen, rowClicks } = setup();
    firstClick(title);
    const events = secondClick(title);
    expect(onopen).toHaveBeenCalledExactlyOnceWith('ws-1');
    expect(rowClicks.mock.calls).toEqual([[1]]);
    expect(events.every((event) => event.defaultPrevented)).toBe(true);
  });

  it('opens when the first click swapped the row for a preview under the cursor', () => {
    const { title, previewButton, onopen, previewClicks } = setup();
    firstClick(title);
    secondClick(previewButton);
    expect(onopen).toHaveBeenCalledExactlyOnceWith('ws-1');
    expect(previewClicks).not.toHaveBeenCalled();
  });

  it('ignores a repeat press that lands away from the first click', () => {
    const { title, previewButton, onopen, previewClicks } = setup();
    firstClick(title);
    secondClick(previewButton, { clientX: 200, clientY: 200 });
    expect(onopen).not.toHaveBeenCalled();
    expect(previewClicks).toHaveBeenCalledOnce();
  });

  it('does not arm on a nested control, a modifier click, or a non-primary button', () => {
    const { title, menu, onopen } = setup();
    const modifier = navigator.platform.toUpperCase().includes('MAC')
      ? { metaKey: true }
      : { ctrlKey: true };
    for (const [target, init] of [
      [menu, {}],
      [title, modifier],
      [title, { shiftKey: true }],
    ] as const) {
      firstClick(target, init);
      secondClick(target, init);
    }
    expect(onopen).not.toHaveBeenCalled();
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

describe('openHomeWorkspaceFromEvent', () => {
  it('opens on a Cmd/Ctrl click and consumes, without reopening, its repeat click', () => {
    const { row, title } = mountHome();
    const onopen = vi.fn();
    const outer = vi.fn();
    document.body.addEventListener('click', outer);
    row.addEventListener('click', (event) => openHomeWorkspaceFromEvent(event, 'ws-1', onopen));
    const modifier = navigator.platform.toUpperCase().includes('MAC')
      ? { metaKey: true }
      : { ctrlKey: true };
    press(title, 'click', { detail: 1, ...modifier });
    press(title, 'click', { detail: 2, ...modifier });
    expect(onopen).toHaveBeenCalledExactlyOnceWith('ws-1');
    expect(outer).not.toHaveBeenCalled();
  });
});
