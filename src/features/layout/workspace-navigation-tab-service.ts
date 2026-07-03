/**
 * Workspace-navigation tab service — post-saga handler for orphaned
 * `workspaceNavigation/openWorkspaceCommitChangeset` triggers.
 *
 * The commit-click → commit-diff navigation lost its handler when the saga
 * runtime was removed (it lived in `slices/app-layout/sagas/app-layout-saga.ts`
 * as `watchOpenCommitChangesetSaga`), so clicking a commit in the workspace
 * overview / chat-changes panel only updated the navigation slice's
 * `mainPanel.type` to `"commit-changeset"` and no UI ever observed it. This
 * restores the behavior WITHOUT re-adding a saga and WITHOUT changing any call
 * site: `createWorkspaceNavigationTabMiddleware()` observes dispatched actions
 * and, on `openWorkspaceCommitChangeset`, opens a `changes` panel tab keyed by
 * `commitHash`. The `ChangesTabType` component renders the per-commit file list
 * and diffs from the store/fetched commit details.
 *
 * Tab open/focus semantics are delegated entirely to the panel-layout reducer:
 * `findDuplicateTabInPanel` already dedupes a `changes` tab by `data.commitHash`,
 * so re-clicking the same commit focuses the existing tab instead of duplicating
 * it. `force: true` mirrors the old saga's user-initiated open.
 *
 * Dependency-light per src/store AGENTS.md: imports only the configured store
 * and the slice actions/types — not selectors.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { store as appStore } from "$store/renderer/store";
import { openWorkspaceCommitChangeset } from "$store/renderer/slices/workspace-navigation/workspace-navigation-slice";
import {
  openTab,
  openTabInAdjacentOrSplit,
} from "$store/renderer/slices/panel-layout/panel-layout-slice";
import type { PanelTab } from "$store/renderer/slices/panel-layout/panel-layout-types";

/** Build the human-friendly tab title shown for a commit changeset. */
function buildCommitTabTitle(commitHash: string, commitMessage?: string): string {
  const shortHash = commitHash.substring(0, 7);
  if (!commitMessage) return `Commit ${shortHash}`;
  const trimmed = commitMessage.length > 20 ? `${commitMessage.substring(0, 20)}...` : commitMessage;
  return `${shortHash}: ${trimmed}`;
}

/**
 * Open (or focus) the panel tab that renders a single commit's file list and
 * diffs. Honors `openInAdjacentPanel` / `sourcePanelId` from the dispatched
 * options and relies on the panel-layout reducer to dedup an already-open tab
 * for the same `commitHash`.
 */
export function openCommitChangesetTab(
  wsId: string,
  commitHash: string,
  commitMessage?: string,
  options?: { openInAdjacentPanel?: boolean; sourcePanelId?: string },
): void {
  if (!wsId || !commitHash) return;

  const tab: Omit<PanelTab, "id"> = {
    type: "changes",
    title: buildCommitTabTitle(commitHash, commitMessage),
    workspaceId: wsId,
    closable: true,
    data: {
      commitHash,
      ...(commitMessage ? { commitMessage } : {}),
    },
  };

  if (options?.openInAdjacentPanel) {
    appStore.dispatch(openTabInAdjacentOrSplit(wsId, tab, options.sourcePanelId, { force: true }));
    return;
  }
  appStore.dispatch(openTab(wsId, tab, options?.sourcePanelId, undefined, true));
}

/**
 * Middleware that gives `openWorkspaceCommitChangeset` a real handler: after
 * the action passes through the reducer, it opens (or focuses) the commit's
 * changes tab in the panel layout. Action payload is the
 * `[wsId, commitHash?, commitMessage?, options?]` tuple.
 */
export function createWorkspaceNavigationTabMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && action.type === openWorkspaceCommitChangeset.type) {
      const payload = (action as { payload?: unknown }).payload;
      if (Array.isArray(payload)) {
        const [wsId, commitHash, commitMessage, options] = payload as [
          string,
          string | undefined,
          string | undefined,
          { openInAdjacentPanel?: boolean; sourcePanelId?: string } | undefined,
        ];
        if (typeof wsId === "string" && typeof commitHash === "string" && commitHash.length > 0) {
          openCommitChangesetTab(wsId, commitHash, commitMessage, options);
        }
      }
    }
    return result;
  };
}
