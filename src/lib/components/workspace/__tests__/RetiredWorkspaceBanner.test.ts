/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import { store } from '$store/renderer/store';
import { requestUnarchiveWorkspace } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
import RetiredWorkspaceBanner from '../RetiredWorkspaceBanner.svelte';

describe('RetiredWorkspaceBanner', () => {
  beforeEach(() => {
    store.init();
  });

  it('explains the workspace is retired and read-only', () => {
    render(RetiredWorkspaceBanner, { workspaceId: 'ws-retired', canRestore: true });
    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain(m.workspace_retiredBanner_title());
    expect(banner.textContent).toContain(m.workspace_retiredBanner_description());
  });

  it('restores as a blank workspace through unarchive', async () => {
    const dispatch = vi.spyOn(store, 'dispatch');
    render(RetiredWorkspaceBanner, { workspaceId: 'ws-retired', canRestore: true });
    await fireEvent.click(screen.getByRole('button', { name: m.workspace_retire_restore_label() }));
    expect(dispatch).toHaveBeenCalledWith(requestUnarchiveWorkspace('ws-retired'));
  });

  it('hides the restore action from viewers who cannot manage the workspace', () => {
    render(RetiredWorkspaceBanner, { workspaceId: 'ws-retired', canRestore: false });
    expect(screen.queryByRole('button', { name: m.workspace_retire_restore_label() })).toBeNull();
  });
});
