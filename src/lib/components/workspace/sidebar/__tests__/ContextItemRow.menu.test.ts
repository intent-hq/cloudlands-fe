import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';
import type { BrowserUrlContextItem } from '$features/context/types';
import ContextItemRow from '../ContextItemRow.svelte';

afterEach(cleanup);
const item: BrowserUrlContextItem = {
  id: 'context-one',
  type: 'browser-url',
  provider: 'browser',
  title: 'Reference',
  url: 'https://example.com/reference',
  createdAt: '',
  updatedAt: '',
};

describe('ContextItemRow commands', () => {
  it.each(['pointer', 'keyboard'])(
    'opens the same target and only removes its context link via %s',
    async (entry) => {
      const onClick = vi.fn();
      const onDelete = vi.fn();
      const onExternalOpen = vi.fn();
      render(ContextItemRow, { item, onClick, onDelete, onExternalOpen });
      const trigger = screen.getByRole('button', { name: /Reference/ });
      await fireEvent.click(trigger);
      expect(onClick).toHaveBeenCalledWith(item);
      if (entry === 'pointer') await fireEvent.contextMenu(trigger);
      else await fireEvent.keyDown(trigger, { key: 'F10', shiftKey: true });
      expect(screen.getAllByRole('menuitem')).toHaveLength(3);
      await fireEvent.click(
        screen.getByRole('menuitem', { name: m.workspace_contextItem_removeFromContext_label() }),
      );
      expect(onDelete).toHaveBeenCalledWith(item);
      expect(onExternalOpen).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    },
  );

  it('dismisses an open menu if the row changes identity', async () => {
    const onDelete = vi.fn();
    const { rerender } = render(ContextItemRow, { item, onDelete });
    await fireEvent.keyDown(screen.getByRole('button', { name: /Reference/ }), {
      key: 'ContextMenu',
    });
    expect(screen.getByRole('menu')).toBeTruthy();
    await rerender({ item: { ...item, id: 'context-two' }, onDelete });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(onDelete).not.toHaveBeenCalled();
  });
});
