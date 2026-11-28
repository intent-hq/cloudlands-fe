/**
 * The hud-left-column preview seeds the shared renderer store. Each named
 * state must drive the production selectors into the fleet it names, and
 * closing the preview must give the app back its own workspace list.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';

import { store as appStore } from '$store/renderer/store';
import {
  resetWorkspaceState,
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { WorkspaceStatus, type Workspace, type WorkspaceId } from '$shared/types';

import Preview from './hud-left-column.preview.svelte';
import { hudLeftColumnPreview } from './hud-left-column.preview-fixtures';

beforeAll(() => appStore.init());
afterAll(() => appStore.dispose());
beforeEach(() => appStore.dispatch(resetWorkspaceState()));
afterEach(cleanup);

const states = hudLeftColumnPreview.states;

function workspaceCount(): HTMLElement {
  return screen.getByTestId('hud-system-workspaces');
}

describe('hud-left-column preview states', () => {
  it('loading keeps the workspace count pending while event rows are present', async () => {
    render(Preview, { props: states.loading.props });
    await waitFor(() => expect(workspaceCount().getAttribute('aria-busy')).toBe('true'));
    expect(appStore.state.workspace.hasLoaded).toBe(false);
    expect(getItems(appStore.state.workspace.workspaces).length).toBeGreaterThan(0);
  });

  it('loaded shows the full count once the list has been read', async () => {
    render(Preview, { props: states.loaded.props });
    await waitFor(() => expect(workspaceCount().getAttribute('aria-busy')).toBe('false'));
    expect(workspaceCount().textContent?.trim()).toBe(
      String(getItems(appStore.state.workspace.workspaces).length),
    );
  });

  it('attention raises agent rows with their request reasons', async () => {
    render(Preview, { props: states.attention.props });
    await waitFor(() =>
      expect(screen.getByTestId('hud-attention-slot').textContent).toContain(
        'The deploy key for the staging cluster was revoked.',
      ),
    );
  });

  it('switching from attention to failed drops the earlier attention requests', async () => {
    const view = render(Preview, { props: states.attention.props });
    await waitFor(() =>
      expect(screen.getByTestId('hud-attention-slot').textContent).toContain('staging cluster'),
    );
    await view.rerender(states.failed.props);
    await waitFor(() => {
      const slot = screen.getByTestId('hud-attention-slot').textContent ?? '';
      expect(slot).toContain('Repair release checks');
      expect(slot).not.toContain('staging cluster');
    });
  });

  it('empty reads as a loaded fleet of zero', async () => {
    render(Preview, { props: states.empty.props });
    await waitFor(() => expect(workspaceCount().textContent?.trim()).toBe('0'));
    expect(workspaceCount().getAttribute('aria-busy')).toBe('false');
  });
});

describe('hud-left-column preview teardown', () => {
  it('restores the workspace list and loaded flag it replaced', async () => {
    const own = {
      id: 'app-workspace' as WorkspaceId,
      title: 'App workspace',
      branch: 'main',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatus.Active,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    } as Workspace;
    appStore.dispatch(setWorkspaceEntity(own));
    appStore.dispatch(setWorkspaceHasLoaded(false));

    const view = render(Preview, { props: states.loaded.props });
    await waitFor(() => expect(appStore.state.workspace.hasLoaded).toBe(true));
    view.unmount();

    expect(getItems(appStore.state.workspace.workspaces).map((item) => item.id)).toEqual([
      'app-workspace',
    ]);
    expect(appStore.state.workspace.hasLoaded).toBe(false);
  });
});
