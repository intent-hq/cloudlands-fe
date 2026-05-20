import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
import type { WorkspaceEvent } from '$features/events/types';
import type { TrackedChange } from '$features/file-tracking/types';
import { selectWorkspaceNavigationState } from '$lib/store/slices/workspace-navigation/workspace-navigation-selectors';
import { selectWorkspacePendingCreations } from '$lib/store/slices/workspace/workspace-selectors';
import {
  closeWorkspaceDrawer,
  markWorkspaceNavigationInitialized,
  openWorkspaceAcceptChanges,
  openWorkspaceBrowser,
  openWorkspaceDiff,
  openWorkspaceDrawer,
  openWorkspaceFile,
  openWorkspaceNote,
  setWorkspaceMainPanel,
  setWorkspaceNavigationWorkspaceStatus,
  type WorkspaceNavigationMainPanelState,
  type WorkspaceNavigationMainPanelType,
  type WorkspaceNavigationWorkspaceState,
} from '$lib/store/slices/workspace-navigation/workspace-navigation-slice';

import { createLogger } from '$lib/utils/client-logger';
import type { Workspace } from '$shared/types';
import { fromStore } from 'svelte/store';
import { dispatchWindowEvent } from '$lib/utils/window-events';
  import { store as appStore } from '$lib/store/store';

const logger = createLogger('workspace-page-state');

export type WorkspacePageState = WorkspaceNavigationWorkspaceState & {
  workspaceData: Workspace | null;
  workspaceEvents: WorkspaceEvent[];
  isComponentMounted: boolean;
};

export function createWorkspacePageState(workspaceId: string) {
  const navigationState = selectWorkspaceNavigationState(workspaceId);
  const navigationStateValue = fromStore(navigationState);
  const pendingCreations = selectWorkspacePendingCreations();
  const pendingCreationsValue = fromStore(pendingCreations);

  let workspaceData = $state<Workspace | null>(null);
  let workspaceEvents = $state<WorkspaceEvent[]>([]);

  const isOptimistic = $derived(workspaceId.startsWith('optimistic-'));
  const transition = $derived.by(() => {
    if (!isOptimistic) {
      return null;
    }

    const pendingCreation = pendingCreationsValue.current[workspaceId];
    if (!pendingCreation) {
      return null;
    }

    return {
      config: {
        title: pendingCreation.title,
        repositoryPath: pendingCreation.repositoryPath,
        branch: pendingCreation.branch || 'main',
      },
    };
  });

  function getNavigationState() {
    return navigationStateValue.current;
  }

  function getState(): WorkspacePageState {
    return {
      ...getNavigationState(),
      workspaceData,
      workspaceEvents,
      isComponentMounted: true,
    };
  }

  function restoreNoteScrollPosition(noteId: string, scrollPosition: number) {
    requestAnimationFrame(() => {
      dispatchWindowEvent('note:restore-scroll-position', { noteId, scrollPosition });
    });
  }

  function restoreFileScrollPosition(filePath: string, scrollPosition: number) {
    requestAnimationFrame(() => {
      dispatchWindowEvent('file:restore-scroll-position', { filePath, scrollPosition });
    });
  }

  return {
    get state(): WorkspacePageState {
      return getState();
    },

    get isOptimistic() {
      return isOptimistic;
    },

    get transition() {
      return transition;
    },

    updateState(updates: Partial<WorkspacePageState>) {
      if ('workspaceData' in updates) {
        workspaceData = updates.workspaceData ?? null;
      }

      if ('workspaceEvents' in updates && updates.workspaceEvents) {
        workspaceEvents = updates.workspaceEvents;
      }

      if (updates.workspace?.status) {
        appStore.dispatch(setWorkspaceNavigationWorkspaceStatus(workspaceId, updates.workspace.status));
      }
    },

    markInitialized() {
      appStore.dispatch(markWorkspaceNavigationInitialized(workspaceId));
    },

    restoreInitialScrollPosition() {
      const state = getNavigationState();
      const entry = state.navigation.history[state.navigation.currentIndex];
      if (!entry || typeof entry.scrollPosition !== 'number') {
        return;
      }

      if (state.mainPanel.type === 'notes' && entry.type === 'note') {
        [100, 250, 500].forEach((delay) => {
          setTimeout(() => restoreNoteScrollPosition(entry.id || '', entry.scrollPosition!), delay);
        });
      }

      if (state.mainPanel.type === 'file' && entry.type === 'file') {
        [100, 250, 500].forEach((delay) => {
          setTimeout(() => restoreFileScrollPosition(entry.id || '', entry.scrollPosition!), delay);
        });
      }
    },

    setMainPanel(
      type: WorkspaceNavigationMainPanelType,
      selection?: Partial<WorkspaceNavigationMainPanelState>,
    ) {
      appStore.dispatch(setWorkspaceMainPanel(workspaceId, type, selection));
    },

    openDrawer(type: 'agent' | 'terminal' | 'overview', itemId?: string | null) {
      appStore.dispatch(openWorkspaceDrawer(workspaceId, type, itemId));
    },

    closeDrawer() {
      appStore.dispatch(closeWorkspaceDrawer(workspaceId));
    },

    openAcceptChanges() {
      appStore.dispatch(openWorkspaceAcceptChanges(workspaceId));
    },

    openDiff(
      change: TrackedChange,
      options?: { changeId?: string; filePath?: string; scrollToLine?: number; forceUpdate?: boolean },
    ) {
      appStore.dispatch(openWorkspaceDiff(workspaceId, change, options));
    },

    openBrowser(url: string) {
      appStore.dispatch(openWorkspaceBrowser(workspaceId, url));
    },

    openBrowserUrl(url: string) {
      appStore.dispatch(openWorkspaceBrowser(workspaceId, url));
    },

    async openFile(
      filePath: string,
      options?: { line?: number; openInAdjacentPanel?: boolean; sourcePanelId?: string },
    ) {
      appStore.dispatch(openWorkspaceFile(workspaceId, filePath, options));
    },

    async openNote(
      noteId: string,
      options?: { openInAdjacentPanel?: boolean; sourcePanelId?: string },
    ) {
      appStore.dispatch(openWorkspaceNote(workspaceId, noteId, options));
    },

    clearCommitView() {
      appStore.dispatch(setWorkspaceMainPanel(workspaceId, 'empty', { selectedCommit: undefined }));
    },

    handleFileRenamed(oldPath: string, newPath: string) {
      getPanelLayoutManager(workspaceId).updateFileTabPath(oldPath, newPath);

      const state = getState();
      const workspaceRoot =
        state.workspaceData?.worktreePath ||
        state.workspaceData?.repositoryPath ||
        state.workspaceData?.path ||
        '';

      const normalize = (path: string) => {
        if (!path) return '';
        if (workspaceRoot && path.startsWith(workspaceRoot)) {
          const stripped = path.slice(workspaceRoot.length);
          return stripped.startsWith('/') ? stripped.slice(1) : stripped;
        }
        return path;
      };

      const oldRelative = normalize(oldPath);
      const newRelative = normalize(newPath);
      const selectedFile = state.mainPanel.selectedFile || '';
      const selectedRelative = normalize(selectedFile);

      if (
        state.mainPanel.type === 'file' &&
        (selectedFile === oldPath || selectedFile === oldRelative || selectedRelative === oldRelative)
      ) {
        appStore.dispatch(
          setWorkspaceMainPanel(workspaceId, 'file', {
            selectedFile: selectedFile === oldPath ? newPath : newRelative,
          }),
        );
      }

      logger.info('Updated workspace page state after file rename', { workspaceId, oldPath, newPath });
    },
  };
}

export type WorkspacePageStateManager = ReturnType<typeof createWorkspacePageState>;