import { m } from '$shared/paraglide/messages.js';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Tab from './Tab.svelte';
import TabOverflowMenu from './TabOverflowMenu.svelte';

afterEach(() => cleanup());

describe('product panel Tab', () => {
  it('preserves selection state and mouse, keyboard, and drag activation hooks', async () => {
    const onclick = vi.fn();
    const ondragstart = vi.fn();
    render(Tab, { props: { id: 'agent-1', active: true, onclick, ondragstart } });

    const tab = screen.getByRole('tab', { name: m.ui_tab_spaceTab_ariaLabel({ id: 'agent-1' }) });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(tab.getAttribute('tabindex')).toBe('0');
    expect(tab.getAttribute('draggable')).toBe('true');

    await fireEvent.click(tab);
    await fireEvent.keyDown(tab, { key: 'Enter' });
    await fireEvent.keyDown(tab, { key: ' ' });
    await fireEvent.dragStart(tab);

    expect(onclick).toHaveBeenCalledTimes(3);
    expect(ondragstart).toHaveBeenCalledOnce();
  });

  it('closes from middle-click and its close button without activating the tab', async () => {
    const onclick = vi.fn();
    const onclose = vi.fn();
    render(Tab, { props: { id: 'note-1', onclick, onclose } });

    const tab = screen.getByRole('tab', { name: m.ui_tab_spaceTab_ariaLabel({ id: 'note-1' }) });
    await fireEvent(tab, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    await fireEvent.click(screen.getByRole('button', { name: 'Close tab' }));

    expect(onclose).toHaveBeenCalledTimes(2);
    expect(onclick).not.toHaveBeenCalled();
  });
});

describe('product panel TabOverflowMenu', () => {
  it('reports open state and closes when the user clicks outside', async () => {
    const onOpenChange = vi.fn();
    render(TabOverflowMenu, { props: { onOpenChange } });

    await fireEvent.click(screen.getByRole('button', { name: 'Show more tabs' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    await fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
