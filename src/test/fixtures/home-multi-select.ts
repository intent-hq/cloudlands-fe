import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '$store/renderer/store';
import { startHomePreviewFixtures } from '$features/home/home-preview-lifecycle';
import { homeWorkspacesSaga } from '$features/home/home-workspaces-saga';
import {
  hydrateHomeWorkspaceSettings,
  updateHomeWorkspaceView,
} from '$features/home/home-workspaces-slice';
import { readHomePersistence } from '$features/home/home-workspaces-persistence';
import { setupHomeLifecycleBridge, type HomeLifecycleCall } from './home-lifecycle-bridge';
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

declare global {
  interface Window {
    __homeMultiSelect?: {
      snapshot: () => {
        calls: HomeLifecycleCall[];
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

/** Seeds Home with active, archived and purged workspaces over a scripted lifecycle bridge. */
export function setupHomeMultiSelectFixtures(view: 'list' | 'board') {
  const dispose = startHomePreviewFixtures({ homePreferences: false });
  const bridge = setupHomeLifecycleBridge();

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
      calls: [...bridge.calls],
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
    bridge.dispose();
    delete window.__homeMultiSelect;
    dispose();
  };
}
