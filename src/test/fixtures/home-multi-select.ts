import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '$store/renderer/store';
import { startHomePreviewFixtures } from '$features/home/home-preview-lifecycle';
import { homeWorkspacesSaga } from '$features/home/home-workspaces-saga';
import {
  hydrateHomeWorkspaceSettings,
  updateHomeWorkspaceView,
} from '$features/home/home-workspaces-slice';
import { readHomePersistence } from '$features/home/home-workspaces-persistence';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { WorkspaceId } from '$shared/types/branded-ids';
import { WorkspaceStatus, type Workspace } from '$shared/types';
import {
  replaceWorkspaceList,
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { setRepos } from '$store/renderer/slices/known-repos/known-repos-slice';
import {
  closePanel,
  hydrateSidebarNav,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { workspaceOperationsSaga } from '$store/renderer/slices/workspace-operations/sagas/workspace-operations-saga';
import { admitLegacyPrincipal } from './principal-state';

interface LifecycleCall {
  method: string;
  workspaceId: string;
}

declare global {
  interface Window {
    __homeMultiSelect?: {
      snapshot: () => {
        calls: LifecycleCall[];
        selectedId: string | null;
        statuses: Record<string, string>;
      };
    };
  }
}

const timestamp = '2026-11-10T12:00:00Z';
const base: Workspace = {
  id: WorkspaceId('multi-a'),
  title: 'Draft the release notes',
  branch: 'docs/release-notes',
  status: WorkspaceStatus.Active,
  displayStatus: 'idle',
  activity: 'idle',
  createdAt: timestamp,
  updatedAt: timestamp,
  lastContentActivity: timestamp,
  repositoryOwner: 'acme',
  repositoryName: 'studio',
  repositoryPath: '/repos/studio',
  path: '/workspaces/multi-a',
  changesets: [],
  timeline: [],
  conversationInfo: [],
};

const SCRIPTED = new Set([
  'workspace.archive',
  'workspace.retire',
  'workspace.delete',
  'workspace.members.list',
  'workspace.list',
  'hook.list',
]);

/**
 * Seeds Home with active, archived and purged workspaces and scripts the
 * lifecycle writes (`workspace.archive`, `workspace.retire`, `workspace.delete`)
 * plus the bulk preflight reads (`workspace.members.list`, `hook.list`). The Archived
 * filter's retired read (`workspace.list { includeRetired }`) finds no extra rows.
 */
export function setupHomeMultiSelectFixtures(view: 'list' | 'board') {
  const dispose = startHomePreviewFixtures({ homePreferences: false });
  const previous = window.electronAPI;
  if (!previous) throw new Error('Home preview bridge is unavailable');
  const calls: LifecycleCall[] = [];
  window.electronAPI = {
    ...previous,
    invoke: async (channel, payload) => {
      const request = payload as { method?: string; params?: { workspaceId?: string } };
      if (
        channel !== IPC_CHANNELS.BACKEND.REQUEST ||
        !request?.method ||
        !SCRIPTED.has(request.method)
      )
        return previous.invoke(channel, payload);
      const workspaceId = request.params?.workspaceId ?? '';
      switch (request.method) {
        case 'workspace.members.list':
          return { ok: true, result: { members: [] } };
        case 'hook.list':
          return { ok: true, result: { hooks: [] } };
        case 'workspace.list':
          return { ok: true, result: { workspaces: [] } };
        default:
          calls.push({ method: request.method, workspaceId });
          return { ok: true, result: { success: true } };
      }
    },
  };

  store.dispatch(hydrateHomeWorkspaceSettings(null, readHomePersistence(undefined)));
  admitLegacyPrincipal();
  store.dispatch(closePanel());
  store.dispatch(hydrateSidebarNav({ pinnedWorkspaceIds: [] }));
  const workspaces: Workspace[] = [
    base,
    {
      ...base,
      id: WorkspaceId('multi-b'),
      title: 'Fix flaky upload test',
      lastContentActivity: '2026-11-10T11:00:00Z',
    },
    {
      ...base,
      id: WorkspaceId('multi-c'),
      title: 'Tune search ranking',
      lastContentActivity: '2026-11-10T10:00:00Z',
    },
    {
      ...base,
      id: WorkspaceId('multi-d'),
      title: 'Plan the onboarding survey',
      lastContentActivity: '2026-11-10T09:00:00Z',
    },
    {
      ...base,
      id: WorkspaceId('multi-archived'),
      title: 'Old billing spike',
      status: WorkspaceStatus.Archived,
      archived: true,
      lastContentActivity: '2026-11-01T09:00:00Z',
    },
    {
      ...base,
      id: WorkspaceId('multi-purged'),
      title: 'Retired prototype',
      status: WorkspaceStatus.Retired,
      archived: true,
      retiredAt: '2026-11-02T09:00:00Z',
      lastContentActivity: '2026-10-30T09:00:00Z',
    },
  ];
  store.dispatch(replaceWorkspaceList(workspaces));
  for (const workspace of workspaces)
    store.dispatch(setWorkspaceEntity(workspace, { detailRead: true }));
  store.dispatch(setWorkspaceHasLoaded(true, store.state.connections.windowBackendId));
  store.dispatch(
    setRepos([
      {
        path: '/repos/studio',
        name: 'studio',
        owner: 'acme',
        addedAt: timestamp,
        lastUsedAt: timestamp,
      },
    ]),
  );
  const stopHome = store.runSaga(homeWorkspacesSaga);
  const stopOperations = store.runSaga(workspaceOperationsSaga);
  store.dispatch(updateHomeWorkspaceView({ view }));
  window.__homeMultiSelect = {
    snapshot: () => ({
      calls: [...calls],
      selectedId: store.state.homeWorkspaces.selectedId,
      statuses: Object.fromEntries(
        getItems(store.state.workspace.workspaces).map((workspace) => [
          workspace.id,
          workspace.status,
        ]),
      ),
    }),
  };
  return () => {
    stopOperations();
    stopHome();
    window.electronAPI = previous;
    delete window.__homeMultiSelect;
    dispose();
  };
}
