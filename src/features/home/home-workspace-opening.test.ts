import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ignoreRepeatHomeWorkspaceClick,
  openHomeWorkspaceFromDoubleClick,
  preventRepeatClickTextSelection,
} from './home-workspace-opening';

function mountCard(): { card: HTMLElement; title: HTMLElement; menu: HTMLButtonElement } {
  const card = document.createElement('div');
  card.setAttribute('role', 'button');
  const title = document.createElement('span');
  title.textContent = 'Review open pull requests';
  const menu = document.createElement('button');
  card.append(title, menu);
  document.body.append(card);
  return { card, title, menu };
}

function dispatchOn(
  card: HTMLElement,
  target: HTMLElement,
  type: 'mousedown' | 'click' | 'dblclick',
  init: MouseEventInit,
  handler: (event: MouseEvent) => void,
): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  card.addEventListener(type, handler, { once: true });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('openHomeWorkspaceFromDoubleClick', () => {
  it('opens the workspace on a primary-button double-click inside the card', () => {
    const { card, title } = mountCard();
    const onopen = vi.fn();
    let opened: boolean | undefined;
    const event = dispatchOn(card, title, 'dblclick', { button: 0, detail: 2 }, (e) => {
      opened = openHomeWorkspaceFromDoubleClick(e, 'ws-1', onopen);
    });
    expect(opened).toBe(true);
    expect(onopen).toHaveBeenCalledExactlyOnceWith('ws-1');
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves Cmd/Ctrl double-clicks to the modifier path that already opened on click 1', () => {
    const { card, title } = mountCard();
    const onopen = vi.fn();
    const modifier = navigator.platform.toUpperCase().includes('MAC')
      ? { metaKey: true }
      : { ctrlKey: true };
    dispatchOn(card, title, 'dblclick', { button: 0, detail: 2, ...modifier }, (e) => {
      openHomeWorkspaceFromDoubleClick(e, 'ws-1', onopen);
    });
    expect(onopen).not.toHaveBeenCalled();
  });

  it('ignores double-clicks on nested controls', () => {
    const { card, menu } = mountCard();
    const onopen = vi.fn();
    let opened: boolean | undefined;
    const event = dispatchOn(card, menu, 'dblclick', { button: 0, detail: 2 }, (e) => {
      opened = openHomeWorkspaceFromDoubleClick(e, 'ws-1', onopen);
    });
    expect(opened).toBe(false);
    expect(onopen).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores non-primary button double-clicks', () => {
    const { card, title } = mountCard();
    const onopen = vi.fn();
    dispatchOn(card, title, 'dblclick', { button: 1, detail: 2 }, (e) => {
      openHomeWorkspaceFromDoubleClick(e, 'ws-1', onopen);
    });
    expect(onopen).not.toHaveBeenCalled();
  });
});

describe('ignoreRepeatHomeWorkspaceClick', () => {
  it('lets the first click of a sequence through', () => {
    const { card, title } = mountCard();
    let ignored: boolean | undefined;
    dispatchOn(card, title, 'click', { detail: 1 }, (e) => {
      ignored = ignoreRepeatHomeWorkspaceClick(e);
    });
    expect(ignored).toBe(false);
  });

  it('lets keyboard-generated clicks through', () => {
    const { card, title } = mountCard();
    let ignored: boolean | undefined;
    dispatchOn(card, title, 'click', { detail: 0 }, (e) => {
      ignored = ignoreRepeatHomeWorkspaceClick(e);
    });
    expect(ignored).toBe(false);
  });

  it('swallows the second click of a double-click so selection is not toggled off', () => {
    const { card, title } = mountCard();
    const outer = vi.fn();
    document.body.addEventListener('click', outer, { once: true });
    let ignored: boolean | undefined;
    dispatchOn(card, title, 'click', { detail: 2 }, (e) => {
      ignored = ignoreRepeatHomeWorkspaceClick(e);
    });
    expect(ignored).toBe(true);
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('preventRepeatClickTextSelection', () => {
  it('blocks the word selection of a double-click on the row body', () => {
    const { card, title } = mountCard();
    const event = dispatchOn(card, title, 'mousedown', { detail: 2 }, (e) =>
      preventRepeatClickTextSelection(e),
    );
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps the first press and nested controls untouched', () => {
    const { card, title, menu } = mountCard();
    const first = dispatchOn(card, title, 'mousedown', { detail: 1 }, (e) =>
      preventRepeatClickTextSelection(e),
    );
    const nested = dispatchOn(card, menu, 'mousedown', { detail: 2 }, (e) =>
      preventRepeatClickTextSelection(e),
    );
    expect(first.defaultPrevented).toBe(false);
    expect(nested.defaultPrevented).toBe(false);
  });
});
