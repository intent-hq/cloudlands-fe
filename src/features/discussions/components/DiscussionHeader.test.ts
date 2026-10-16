import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { m } from '$shared/paraglide/messages.js';
import DiscussionHeader from './DiscussionHeader.svelte';
afterEach(cleanup);
function props() {
  return {
    title: 'Feature UI',
    conversationId: 'feature',
    rows: [
      { id: 'default', title: 'Workspace' },
      { id: 'feature', title: 'Feature UI' },
    ],
    onSelect: vi.fn(),
    onNew: vi.fn(),
    onClose: vi.fn(),
    onRefresh: vi.fn(),
  };
}
describe('discussion header controls', () => {
  it('lists accessible conversations and switches to the selected destination', async () => {
    const callbacks = props();
    render(DiscussionHeader, callbacks);
    await fireEvent.click(
      screen.getByRole('button', { name: m.workspace_discussion_list_label() }),
    );
    expect(screen.getByRole('menuitem', { name: 'Feature UI' }).getAttribute('aria-current')).toBe(
      'page',
    );
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Workspace' }));
    expect(callbacks.onSelect).toHaveBeenCalledExactlyOnceWith('default', 'Workspace');
  });
  it('starts a new conversation and closes through the supplied pane action', async () => {
    const callbacks = props();
    render(DiscussionHeader, callbacks);
    await fireEvent.click(
      screen.getByRole('button', { name: m.workspace_discussion_list_label() }),
    );
    await fireEvent.click(
      screen.getByRole('menuitem', { name: m.workspace_discussion_new_title() }),
    );
    expect(callbacks.onNew).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByRole('button', { name: m.layout_panelTabBar_close_label() }));
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });
  it('refreshes through the overflow menu', async () => {
    const callbacks = props();
    render(DiscussionHeader, callbacks);
    await fireEvent.click(
      screen.getByRole('button', { name: m.layout_panelTabBar_paneMenu_ariaLabel() }),
    );
    await fireEvent.click(
      screen.getByRole('menuitem', { name: m.workspace_commitsTimeline_refresh_label() }),
    );
    expect(callbacks.onRefresh).toHaveBeenCalledOnce();
  });
});
