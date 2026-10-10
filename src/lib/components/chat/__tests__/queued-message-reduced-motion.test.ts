/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueuedMessage } from '$shared/types';

vi.mock('../../ui/button/button.svelte', async () => ({
  default: (await import('./mocks/Button.svelte')).default,
}));

import QueuedMessageList from '../QueuedMessageList.svelte';

function queued(id: string, position: number): QueuedMessage {
  return {
    id,
    content: `message ${id}`,
    queuedAt: '2026-01-01T00:00:00.000Z',
    position,
    messageMetadata: { fromPrincipalId: 'self' },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('queued message reduced motion', () => {
  it.each([true, false])(
    'preserves an early selection when autofocus runs (focused: %s)',
    async (focused) => {
      vi.spyOn(window, 'matchMedia').mockReturnValue({
        matches: true,
        media: '(prefers-reduced-motion: reduce)',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      });
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
      const frames = new Map<number, FrameRequestCallback>();
      let sequence = 0;
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.set(++sequence, callback);
        return sequence;
      });
      vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
      const onedit = vi.fn().mockResolvedValue({ success: true });
      const message = queued('one', 0);
      const view = render(QueuedMessageList, {
        props: { messages: [message], ownPrincipalId: 'self', onedit },
      });
      await fireEvent.dblClick(screen.getByTestId('queued-message-content'));
      const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement;
      if (focused) {
        textarea.focus();
        textarea.setSelectionRange(0, textarea.value.length);
      }
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(performance.now());
      expect(document.activeElement).toBe(textarea);
      expect(textarea.selectionStart).toBe(focused ? 0 : message.content.length);
      expect(textarea.selectionEnd).toBe(message.content.length);
      if (focused) {
        textarea.setRangeText(
          'Replacement retry message',
          textarea.selectionStart,
          textarea.selectionEnd,
          'end',
        );
        await fireEvent.input(textarea);
        await fireEvent.keyDown(textarea, { key: 'Enter' });
        await waitFor(() =>
          expect(onedit).toHaveBeenLastCalledWith(message.id, 'Replacement retry message', false),
        );
      }
      view.unmount();
    },
  );

  it('creates no animations through edit, cancel, save, reorder, and removal', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    const animate = vi.spyOn(Element.prototype, 'animate');
    const onedit = vi.fn().mockResolvedValue({ success: true });
    const first = queued('one', 0);
    const second = queued('two', 1);
    const view = render(QueuedMessageList, {
      props: { messages: [first, second], ownPrincipalId: 'self', onedit },
    });

    await fireEvent.dblClick(screen.getAllByTestId('queued-message-content')[0]);
    const textarea = await waitFor(() => view.container.querySelector('textarea'));
    await waitFor(() => expect(document.activeElement).toBe(textarea));
    await fireEvent.input(textarea!, { target: { value: 'selection text' } });
    textarea!.setSelectionRange(2, 7);
    await view.rerender({ messages: [second, first], onedit });
    await waitFor(() => expect(document.activeElement).toBe(textarea));
    expect(textarea!.selectionStart).toBe(2);
    expect(textarea!.selectionEnd).toBe(7);
    expect(animate).not.toHaveBeenCalled();

    await fireEvent.keyDown(textarea!, { key: 'Escape' });
    await waitFor(() => expect(view.container.querySelector('textarea')).toBeNull());
    expect(animate).not.toHaveBeenCalled();

    await fireEvent.dblClick(screen.getAllByTestId('queued-message-content')[0]);
    const savedTextarea = await waitFor(() => view.container.querySelector('textarea'));
    await fireEvent.input(savedTextarea!, { target: { value: 'saved' } });
    await fireEvent.keyDown(savedTextarea!, { key: 'Enter' });
    await waitFor(() => expect(view.container.querySelector('textarea')).toBeNull());
    expect(animate).not.toHaveBeenCalled();

    await view.rerender({ messages: [first], onedit });
    await fireEvent.dblClick(screen.getByTestId('queued-message-content'));
    await waitFor(() => expect(view.container.querySelector('textarea')).toBeTruthy());
    await view.rerender({ messages: [], onedit });
    await waitFor(() => expect(view.container.querySelector('textarea')).toBeNull());
    expect(animate).not.toHaveBeenCalled();
  });
});
