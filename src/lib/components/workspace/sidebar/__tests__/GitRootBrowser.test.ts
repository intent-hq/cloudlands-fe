import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import {
  setWorkspaceEntity,
  removeWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import { gitRootsUpdated } from '$store/renderer/slices/git-roots/git-roots-slice';
import { createMockWorkspace } from '../../../../../test/factories/workspace.factory';
import { WorkspaceId } from '$shared/types/branded-ids';
import { m } from '$shared/paraglide/messages.js';
import type { GitRootRow } from '$features/git-roots/git-roots-service';
import GitRootBrowser from '../GitRootBrowser.svelte';

vi.mock('../SecondaryRootChangesView.svelte', async () => ({
  default: (await import('./mocks/MockSimple.svelte')).default,
}));
const workspaceId = WorkspaceId('git-root-picker');
const roots: GitRootRow[] = ['/alpha/packages/api', '/beta/packages/api'].map((path, index) => ({
  id: `root-${index}`,
  workspaceId,
  path,
  source: 'agent',
  createdAt: '',
  updatedAt: '',
}));
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => {
  appStore.init();
  appStore.dispatch(
    setWorkspaceEntity(createMockWorkspace({ id: workspaceId, path: '/worktree' })),
  );
  appStore.dispatch(gitRootsUpdated(workspaceId, roots));
});
afterEach(() => {
  cleanup();
  appStore.dispatch(removeWorkspaceEntity(workspaceId));
});

describe('GitRootBrowser stable identities', () => {
  it('disambiguates equal basenames and reports the selected root identity', async () => {
    const onSelectedRootChange = vi.fn();
    render(GitRootBrowser, { workspaceId, onSelectedRootChange });
    await fireEvent.click(
      screen.getByRole('combobox', { name: m.workspace_sidebarChanges_rootSelector_ariaLabel() }),
    );
    const choice = screen.getByRole('option', { name: /\/beta\/packages\/api/ });
    expect(screen.getByRole('option', { name: /\/alpha\/packages\/api/ })).toBeTruthy();
    await fireEvent.pointerUp(choice, { pointerType: 'mouse' });
    await waitFor(() =>
      expect(onSelectedRootChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ key: 'root-1' }),
      ),
    );
    appStore.dispatch(gitRootsUpdated(workspaceId, [roots[0]]));
    await waitFor(() => expect(onSelectedRootChange).toHaveBeenLastCalledWith(null));
    expect(screen.getByRole('status').textContent).toBe(
      m.workspace_sidebarChanges_rootRemoved_status(),
    );
  });

  it('does not render an empty selector without secondary roots', () => {
    appStore.dispatch(gitRootsUpdated(workspaceId, []));
    render(GitRootBrowser, { workspaceId });
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
