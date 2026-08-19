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
  };
}

afterEach(() => vi.restoreAllMocks());

describe('queued message reduced motion', () => {
  it('creates no animations through edit, cancel, save, reorder, and removal', async () => {
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
    const view = render(QueuedMessageList, { props: { messages: [first, second], onedit } });

    await fireEvent.click(screen.getAllByTestId('queued-message-content')[0]);
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

    await fireEvent.click(screen.getAllByTestId('queued-message-content')[0]);
    const savedTextarea = await waitFor(() => view.container.querySelector('textarea'));
    await fireEvent.input(savedTextarea!, { target: { value: 'saved' } });
    await fireEvent.keyDown(savedTextarea!, { key: 'Enter' });
    await waitFor(() => expect(view.container.querySelector('textarea')).toBeNull());
    expect(animate).not.toHaveBeenCalled();

    await view.rerender({ messages: [first], onedit });
    await fireEvent.click(screen.getByTestId('queued-message-content'));
    await waitFor(() => expect(view.container.querySelector('textarea')).toBeTruthy());
    await view.rerender({ messages: [], onedit });
    await waitFor(() => expect(view.container.querySelector('textarea')).toBeNull());
    expect(animate).not.toHaveBeenCalled();
  });
});
