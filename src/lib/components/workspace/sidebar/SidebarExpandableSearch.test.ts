import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import SidebarExpandableSearch from './SidebarExpandableSearch.svelte';
import SidebarHeaderAction from './SidebarHeaderAction.svelte';

describe('SidebarExpandableSearch', () => {
  it('expands with focus, clears on Escape, and restores trigger focus', async () => {
    const view = render(SidebarExpandableSearch, {
      props: { placeholder: 'Search agents...', scope: 'agents' },
    });
    const trigger = view.getByRole('button', { name: 'Search agents...' });
    await fireEvent.click(trigger);

    const input = view.getByRole('searchbox', { name: 'Search agents...' });
    expect(document.activeElement).toBe(input);
    await fireEvent.input(input, { target: { value: 'café' } });
    expect((input as HTMLInputElement).value).toBe('café');
    await fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(view.queryByRole('searchbox')).toBeNull());
    expect(document.activeElement).toBe(view.getByRole('button', { name: 'Search agents...' }));
  });

  it.each(['plus', 'search', 'close'] as const)(
    'routes the %s action to its caller',
    async (icon) => {
      const onclick = vi.fn();
      const view = render(SidebarHeaderAction, { props: { icon, label: icon, onclick } });
      await fireEvent.click(view.getByRole('button', { name: icon }));
      expect(onclick).toHaveBeenCalledOnce();
    },
  );

  it('forwards file-search navigation and clears without losing input focus', async () => {
    const onKeydown = vi.fn();
    const view = render(SidebarExpandableSearch, {
      props: { placeholder: 'Search files', scope: 'files', placement: 'toolbar', onKeydown },
    });
    await fireEvent.click(view.getByRole('button', { name: 'Search files' }));
    const input = view.getByRole('searchbox');
    await fireEvent.input(input, { target: { value: 'README' } });
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onKeydown).toHaveBeenCalledWith(expect.objectContaining({ key: 'ArrowDown' }));
    await fireEvent.click(view.container.querySelector('[data-sidebar-search-clear="files"]')!);
    expect((input as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(input);
  });
});
