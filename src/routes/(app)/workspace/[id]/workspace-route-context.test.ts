/**
 * @vitest-environment jsdom
 *
 * The workspace route page hands the route param to the retention surface, so
 * a workspace switch keeps the previous surface mounted (inactive) instead of
 * remounting a single surface keyed by the route.
 */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { readable, writable } from 'svelte/store';
import { createSubscriber } from 'svelte/reactivity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  routeId: 'workspace-a',
  notify: undefined as (() => void) | undefined,
  openWorkspaceIds: ['workspace-a', 'workspace-b'],
  browserWorkspaceIds: [] as string[],
  workspaceItems: [
    { id: 'workspace-a', title: 'A' },
    { id: 'workspace-b', title: 'B' },
  ],
  search: '',
  loadStatus: undefined as unknown as import('svelte/store').Writable<{ status: string }>,
  dispatch: vi.fn(),
  replaceState: vi.fn(),
}));

vi.mock('$app/state', () => {
  const subscribe = createSubscriber((update) => {
    mocks.notify = update;
    return () => {
      mocks.notify = undefined;
    };
  });
  return {
    page: {
      get params() {
        subscribe();
        return { id: mocks.routeId };
      },
      get url() {
        subscribe();
        return new URL(`/workspace/${mocks.routeId}${mocks.search}`, 'http://daemon.localhost');
      },
      state: {},
    },
  };
});
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: () => readable(null),
  selectWorkspaceItems: () => readable(mocks.workspaceItems),
}));
vi.mock('$app/navigation', () => ({ replaceState: mocks.replaceState }));
vi.mock('$store/renderer/store', () => ({ store: { dispatch: mocks.dispatch } }));
vi.mock('$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-selectors', () => ({
  selectWorkspaceLoadState: () => mocks.loadStatus,
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectActiveWorkspaceIds: () => readable(mocks.openWorkspaceIds),
}));
vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectBrowserWorkspaceIds: () => readable(mocks.browserWorkspaceIds),
}));
vi.mock('./WorkspaceSurface.svelte', async () => {
  const component = (await import('./__tests__/mocks/MockWorkspaceSurfacePart.svelte')).default;
  const renderPart = component as unknown as (anchor: Node, props: Record<string, unknown>) => void;
  // Keep the reactive prop getters intact so `active` updates reach the mock.
  return {
    default: (anchor: Node, props: Record<string, unknown>) =>
      renderPart(anchor, Object.create(props, { marker: { value: 'workspace-surface' } })),
  };
});

import WorkspacePage from './+page.svelte';
import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { openWorkspaceNote } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';

function navigateTo(workspaceId: string) {
  mocks.routeId = workspaceId;
  mocks.notify?.();
}

function surfaces(container: HTMLElement) {
  return [
    ...container.querySelectorAll<HTMLElement>('[data-workspace-surface-part="workspace-surface"]'),
  ].map((surface) => ({
    workspaceId: surface.dataset.workspaceId,
    active: surface.dataset.active,
    retained: surface.closest<HTMLElement>('[data-retained-workspace-surface]')?.dataset
      .retainedWorkspaceActive,
  }));
}

describe('workspace route page', () => {
  beforeEach(() => {
    mocks.routeId = 'workspace-a';
    mocks.openWorkspaceIds = ['workspace-a', 'workspace-b'];
    mocks.browserWorkspaceIds = [];
    mocks.search = '';
    mocks.loadStatus = writable({ status: 'ready' });
    mocks.dispatch.mockClear();
    mocks.replaceState.mockClear();
    mocks.workspaceItems = [
      { id: 'workspace-a', title: 'A' },
      { id: 'workspace-b', title: 'B' },
    ];
  });

  afterEach(cleanup);

  it('keeps the browser workspace instance when navigation exceeds the surface cache limit', async () => {
    mocks.openWorkspaceIds = ['workspace-a', 'workspace-b', 'workspace-c', 'workspace-d'];
    mocks.workspaceItems = mocks.openWorkspaceIds.map((id) => ({ id, title: id }));
    mocks.browserWorkspaceIds = ['workspace-a'];
    const { container } = render(WorkspacePage);
    const browserSurface = container.querySelector('[data-workspace-id="workspace-a"]');
    expect(browserSurface).not.toBeNull();

    for (const workspaceId of ['workspace-b', 'workspace-c', 'workspace-d']) {
      navigateTo(workspaceId);
      await waitFor(() =>
        expect(surfaces(container)).toContainEqual({
          workspaceId,
          active: 'true',
          retained: 'true',
        }),
      );
      expect(container.querySelector('[data-workspace-id="workspace-a"]')).toBe(browserSurface);
    }

    navigateTo('workspace-a');
    await waitFor(() =>
      expect(surfaces(container)).toContainEqual({
        workspaceId: 'workspace-a',
        active: 'true',
        retained: 'true',
      }),
    );
    expect(container.querySelector('[data-workspace-id="workspace-a"]')).toBe(browserSurface);
  });

  it('routes workspace changes through the active-gated retention surface', async () => {
    const { container } = render(WorkspacePage);
    expect(surfaces(container)).toEqual([
      { workspaceId: 'workspace-a', active: 'true', retained: 'true' },
    ]);

    navigateTo('workspace-b');
    await waitFor(() =>
      expect(surfaces(container)).toEqual([
        { workspaceId: 'workspace-a', active: 'false', retained: 'false' },
        { workspaceId: 'workspace-b', active: 'true', retained: 'true' },
      ]),
    );

    // Returning reactivates the retained surface instead of mounting a new one.
    const [firstSurface] = container.querySelectorAll('[data-retained-workspace-surface]');
    navigateTo('workspace-a');
    await waitFor(() =>
      expect(surfaces(container)).toEqual([
        { workspaceId: 'workspace-a', active: 'true', retained: 'true' },
        { workspaceId: 'workspace-b', active: 'false', retained: 'false' },
      ]),
    );
    expect(container.querySelectorAll('[data-retained-workspace-surface]')[0]).toBe(firstSurface);
  });

  it('opens the note and agent named in the URL once the workspace is ready', async () => {
    mocks.search = '?note=spec&agent=agent-7';
    mocks.loadStatus = writable({ status: 'loading' });
    render(WorkspacePage);
    expect(mocks.dispatch).not.toHaveBeenCalled();

    mocks.loadStatus.set({ status: 'ready' });
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledTimes(2));
    expect(mocks.dispatch.mock.calls.map(([action]) => action)).toEqual([
      openWorkspaceNote('workspace-a', 'spec'),
      openAgentTabRequested('workspace-a', { agentId: 'agent-7' }),
    ]);
    expect(mocks.replaceState).toHaveBeenCalledExactlyOnceWith('/workspace/workspace-a', {});
  });
});
