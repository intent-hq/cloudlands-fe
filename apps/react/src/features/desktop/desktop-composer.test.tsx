import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesktopComposer } from './desktop-composer';
import type { MessageComposerProps } from '@/components/ui/message-composer';
import { store } from '@/store';
import { setShortcutOverride } from '../../../../../src/store/renderer/slices/user-preferences/user-preferences-slice';

let host: HTMLDivElement, root: ReturnType<typeof createRoot>, dispose: () => void;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dispose = store.init();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  dispose();
  vi.unstubAllGlobals();
});
async function render(props: MessageComposerProps) {
  await act(async () => root.render(<DesktopComposer {...props} />));
}
async function key(init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  await act(async () => host.querySelector('textarea')!.dispatchEvent(event));
  return event;
}
it('sends once on ordinary Enter, preserving the exact authored payload apart from source trimming', async () => {
  const send = vi.fn();
  await render({ value: '  café Ω\nsecond line  ', onSend: send });
  expect((await key()).defaultPrevented).toBe(true);
  expect(send).toHaveBeenCalledExactlyOnceWith('café Ω\nsecond line', []);
});
it('leaves Shift-Enter and composition Enter to the native editor without sending', async () => {
  const send = vi.fn();
  await render({ value: 'text', onSend: send });
  expect((await key({ shiftKey: true })).defaultPrevented).toBe(false);
  expect((await key({ isComposing: true })).defaultPrevented).toBe(false);
  expect(send).not.toHaveBeenCalled();
});
it('honors the current configured send binding and leaves ordinary Enter alone', async () => {
  store.dispatch(setShortcutOverride('chat.send', 'mod+enter'));
  const send = vi.fn();
  await render({ value: 'text', onSend: send });
  expect((await key()).defaultPrevented).toBe(false);
  await key({ ctrlKey: true });
  expect(send).toHaveBeenCalledTimes(1);
});
it('does not stop with an empty Enter; the explicit Stop button does', async () => {
  const stop = vi.fn();
  await render({ value: '', status: 'streaming', onStop: stop });
  await key();
  expect(stop).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>('.desktop-composer-submit')!.click());
  expect(stop).toHaveBeenCalledTimes(1);
});
it('blocks pending send and explicit disabled stop without dropping the draft', async () => {
  const send = vi.fn(),
    stop = vi.fn();
  await render({ value: 'retained', onSend: send, sendDisabled: true });
  await key();
  expect(send).not.toHaveBeenCalled();
  expect(host.querySelector('textarea')!.value).toBe('retained');
  await render({ value: '', status: 'streaming', disabled: true, onStop: stop });
  expect(host.querySelector<HTMLButtonElement>('.desktop-composer-submit')!.disabled).toBe(true);
});
it('delegates a busy text choice to the canonical enqueue callback without local draining or clearing', async () => {
  const enqueue = vi.fn(),
    send = vi.fn(),
    edit = vi.fn();
  await render({
    value: 'next',
    status: 'streaming',
    onEnqueue: enqueue,
    onSend: send,
    onValueChange: edit,
  });
  await key();
  expect(enqueue).toHaveBeenCalledExactlyOnceWith('next');
  await render({
    value: 'next',
    status: 'idle',
    onEnqueue: enqueue,
    onSend: send,
    onValueChange: edit,
  });
  expect(send).not.toHaveBeenCalled();
  expect(edit).not.toHaveBeenCalled();
});
it('keeps native caret and focus across controlled rerenders and reveals the source placeholder only while focused', async () => {
  await render({ value: 'α beta\nγ' });
  const input = host.querySelector('textarea')!;
  await act(async () => {
    input.focus();
    input.setSelectionRange(2, 4);
  });
  await render({ value: 'α beta\nγ', status: 'streaming' });
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([2, 4]);
  await render({ value: '' });
  expect(input.placeholder).not.toBe('');
  await act(async () => input.blur());
  expect(input.placeholder).toBe('');
});

it('retains each native edit before a coalesced canonical value prop arrives', async () => {
  const edit = vi.fn();
  await render({ value: '', onValueChange: edit });
  const input = host.querySelector('textarea')!;
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  for (const value of ['c', 'café Ω', 'café Ω\nsecond line']) {
    await act(async () => {
      set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe(value);
  }
  expect(edit).toHaveBeenLastCalledWith('café Ω\nsecond line');
  await render({ value: 'café Ω\nsecond line', onValueChange: edit });
  expect(input.value).toBe('café Ω\nsecond line');
  await render({ value: '', onValueChange: edit });
  expect(input.value).toBe('');
});

it('resizes from its rendered height within source bounds and resets to automatic sizing without sending', async () => {
  const send = vi.fn();
  await render({ value: 'retained Ω', onSend: send });
  const composer = host.querySelector<HTMLElement>('.desktop-text-composer')!;
  const handle = host.querySelector<HTMLElement>('.desktop-composer-resize')!;
  Object.defineProperty(composer, 'offsetHeight', { value: 100 });
  await act(async () =>
    handle.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientY: 200, bubbles: true })),
  );
  await act(async () => document.dispatchEvent(new MouseEvent('mousemove', { clientY: 140 })));
  expect(composer.style.height).toBe('160px');
  await act(async () => document.dispatchEvent(new MouseEvent('mousemove', { clientY: -1000 })));
  expect(composer.style.height).toBe('800px');
  await act(async () => document.dispatchEvent(new MouseEvent('mousemove', { clientY: 1000 })));
  expect(composer.style.height).toBe('65px');
  await act(async () => document.dispatchEvent(new MouseEvent('mouseup')));
  await render({ value: 'newer draft Ω', onSend: send });
  expect(composer.style.height).toBe('65px');
  await act(async () => handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
  expect(composer.style.height).toBe('');
  expect(composer.dataset.manualHeight).toBe('false');
  expect(host.querySelector('textarea')!.value).toBe('newer draft Ω');
  expect(send).not.toHaveBeenCalled();
});

it('releases the document resize listeners when its retained pane becomes hidden', async () => {
  await render({ value: 'draft' });
  const composer = host.querySelector<HTMLElement>('.desktop-text-composer')!;
  const handle = host.querySelector<HTMLElement>('.desktop-composer-resize')!;
  Object.defineProperty(composer, 'offsetHeight', { value: 100 });
  await act(async () =>
    handle.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientY: 200, bubbles: true })),
  );
  await act(async () => document.dispatchEvent(new MouseEvent('mousemove', { clientY: 140 })));
  expect(composer.style.height).toBe('160px');
  await act(async () => {
    host.hidden = true;
  });
  await act(async () => document.dispatchEvent(new MouseEvent('mousemove', { clientY: 100 })));
  expect(composer.style.height).toBe('160px');
  expect(handle.dataset.resizing).toBe('false');
  host.hidden = false;
});

it('disposes an in-progress resize on unmount', async () => {
  await render({ value: 'draft' });
  const remove = vi.spyOn(document, 'removeEventListener');
  const handle = host.querySelector<HTMLElement>('.desktop-composer-resize')!;
  await act(async () =>
    handle.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientY: 200, bubbles: true })),
  );
  await act(async () => root.render(null));
  expect(remove).toHaveBeenCalledWith('mousemove', expect.any(Function));
  expect(remove).toHaveBeenCalledWith('mouseup', expect.any(Function));
  remove.mockRestore();
});
