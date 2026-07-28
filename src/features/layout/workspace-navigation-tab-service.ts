/**
 * Workspace-navigation tab service — post-saga handler for the orphaned
 * click-time `workspaceNavigation/openWorkspace*` triggers that used to open
 * a real `panel-layout` tab.
 *
 * When the saga runtime was removed, `slices/app-layout/sagas/app-layout-saga.ts`
 * went with it — including `watchOpenFileSaga`, `watchOpenNoteSaga`,
 * `watchOpenDiffSaga`, and `watchOpenCommitChangesetSaga`. Their triggers
 * (`openWorkspaceFile`, `openWorkspaceNote`, `openWorkspaceDiff`,
 * `openWorkspaceCommitChangeset`) still update `mainPanel.*` in the
 * workspace-navigation slice, but nothing observed them anymore, so clicks
 * from CommandPalette, tool-call panels, sidebar file lists, markdown link
 * openers, `+layout.svelte`, etc. no longer opened a panel tab.
 *
 * This restores the behavior WITHOUT re-adding a saga and WITHOUT changing any
 * call site: `createWorkspaceNavigationTabMiddleware()` observes dispatched
 * actions and, after the reducer runs, dispatches the corresponding
 * `panelLayout/openTab` (or `openTabInAdjacentOrSplit`) with the same tab
 * shape the old sagas built. Tab open/focus semantics are delegated entirely
 * to the panel-layout reducer: `findDuplicateTabInPanel` already dedupes tabs
 * by `noteId` / `filePath` / `diffPath` / `data.commitHash`, so re-clicking
 * the same target focuses the existing tab instead of duplicating it.
 * `force: true` mirrors the old sagas' user-initiated opens.
 *
 * Sibling actions that never had a panel-layout tab handler even in the saga
 * world (`openWorkspaceBrowser`, `openWorkspaceAcceptChanges`,
 * `openWorkspaceCodeReview`) are intentionally left alone — they only updated
 * the workspace-navigation `mainPanel.*` state which was rendered by the now-
 * removed `VSCodeResizablePanels`. Restoring their UX belongs with the
 * follow-up items tracked alongside spec-panel cold-open and navigation
 * persistence, not with this saga-parity restoration.
 *
 * Dependency-light per src/store AGENTS.md: imports only the configured store
 * and the slice actions/types — not selectors. Note/tab-panel lookups read
 * directly off `appStore.state`.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { store as appStore } from "$store/renderer/store";
import {
  openWorkspaceCommitChangeset,
  openWorkspaceDiff,
  openWorkspaceFile,
  openWorkspaceNote,
} from "$store/renderer/slices/workspace-navigation/workspace-navigation-slice";
import {
  openTab,
  openTabInAdjacentOrSplit,
} from "$store/renderer/slices/panel-layout/panel-layout-slice";
import type { PanelTab } from "$store/renderer/slices/panel-layout/panel-layout-types";
import type { TrackedChange } from "$features/file-tracking/types";
import { m } from "$shared/paraglide/messages.js";

/** Build the human-friendly tab title shown for a commit changeset. */
function buildCommitTabTitle(commitHash: string, commitMessage?: string): string {
  const shortHash = commitHash.substring(0, 7);
  if (!commitMessage) return m.layout_navigation_commit_title({ hash: shortHash });
  const trimmed = commitMessage.length > 20 ? `${commitMessage.substring(0, 20)}...` : commitMessage;
  return `${shortHash}: ${trimmed}`;
}

/** Peek the note title out of the workspace-notes slice without going through a selector. */
function lookupNoteTitle(wsId: string, noteId: string): string | undefined {
  const state = appStore.state as {
    workspaceNotes?: {
      byWorkspaceId?: Record<string, { notes?: { map?: Record<string, { title?: string }> } }>;
    };
  };
  const notes = state.workspaceNotes?.byWorkspaceId?.[wsId]?.notes?.map;
  return notes?.[noteId]?.title;
}

/** Peek the active-tab type of a panel out of the panel-layout slice without a selector. */
function lookupPanelActiveTabType(wsId: string, panelId: string): string | undefined {
  const state = appStore.state as {
    panelLayout?: {
      byWorkspaceId?: Record<
        string,
        {
          panels?: Record<
            string,
            { activeTabId?: string | null; tabs?: Array<{ id: string; type: string }> }
          >;
        }
      >;
    };
  };
  const panel = state.panelLayout?.byWorkspaceId?.[wsId]?.panels?.[panelId];
  if (!panel) return undefined;
  const activeId = panel.activeTabId;
  return panel.tabs?.find((tab) => tab.id === activeId)?.type;
}

/** Dispatch the standard force-open, honoring adjacent-panel and source-panel routing. */
function dispatchOpenTab(
  wsId: string,
  tab: Omit<PanelTab, "id">,
  openInAdjacentPanel: boolean,
  sourcePanelId?: string,
): void {
  if (openInAdjacentPanel) {
    appStore.dispatch(openTabInAdjacentOrSplit(wsId, tab, sourcePanelId, { force: true }));
    return;
  }
  appStore.dispatch(openTab(wsId, tab, sourcePanelId, undefined, true));
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

  dispatchOpenTab(wsId, tab, options?.openInAdjacentPanel ?? false, options?.sourcePanelId);
}

/**
 * Open (or focus) a file tab for `filePath` in the panel layout. Mirrors the
 * removed `watchOpenFileSaga`: the tab's `data.line` / `data.jumpTimestamp`
 * lets `FileTabType` scroll to a specific line on re-open of the same file.
 */
export function openFileTab(
  wsId: string,
  filePath: string,
  options?: { line?: number; openInAdjacentPanel?: boolean; sourcePanelId?: string },
): void {
  if (!wsId || !filePath) return;

  const tab: Omit<PanelTab, "id"> = {
    type: "file",
    title: filePath.split("/").pop() || m.layout_tabTypes_file_title(),
    filePath,
    workspaceId: wsId,
    closable: true,
    ...(options?.line ? { data: { line: options.line, jumpTimestamp: Date.now() } } : {}),
  };

  dispatchOpenTab(wsId, tab, options?.openInAdjacentPanel ?? false, options?.sourcePanelId);
}

/**
 * Open (or focus) a note tab for `noteId` in the panel layout. Mirrors the
 * removed `watchOpenNoteSaga`: when the source panel is currently showing an
 * agent tab, the note opens adjacent so the agent conversation stays visible,
 * matching the "notes never replace an active agent" heuristic.
 */
export function openNoteTab(
  wsId: string,
  noteId: string,
  options?: { openInAdjacentPanel?: boolean; sourcePanelId?: string },
): void {
  if (!wsId || !noteId) return;

  let openInAdjacentPanel = options?.openInAdjacentPanel ?? false;
  if (!openInAdjacentPanel && options?.sourcePanelId) {
    if (lookupPanelActiveTabType(wsId, options.sourcePanelId) === "agent") {
      openInAdjacentPanel = true;
    }
  }

  const tab: Omit<PanelTab, "id"> = {
    type: "note",
    title: lookupNoteTitle(wsId, noteId) || noteId,
    noteId,
    workspaceId: wsId,
    closable: true,
  };

  dispatchOpenTab(wsId, tab, openInAdjacentPanel, options?.sourcePanelId);
}

/**
 * Open (or focus) a diff tab for a tracked change in the panel layout. Mirrors
 * the removed `watchOpenDiffSaga`: `data.change` carries the full TrackedChange
 * for the diff viewer and `branchBaseRef` / `branchBaseCommitSha` propagate the
 * PR-diff base overrides.
 */
export function openDiffTab(
  wsId: string,
  change: TrackedChange | undefined,
  options?: {
    filePath?: string;
    changeId?: string;
    scrollToLine?: number;
    forceUpdate?: boolean;
    openInAdjacentPanel?: boolean;
    sourcePanelId?: string;
    branchBaseRef?: string;
    branchBaseCommitSha?: string;
  },
): void {
  const filePath = options?.filePath || change?.file || change?.relativePath;
  if (!wsId || !filePath) return;

  const tab: Omit<PanelTab, "id"> = {
    type: "diff",
    title: filePath.split("/").pop() || m.layout_tabTypes_diff_title(),
    diffPath: filePath,
    workspaceId: wsId,
    closable: true,
    data: {
      change,
      ...(options?.branchBaseRef ? { branchBaseRef: options.branchBaseRef } : {}),
      ...(options?.branchBaseCommitSha ? { branchBaseCommitSha: options.branchBaseCommitSha } : {}),
    },
  };

  dispatchOpenTab(wsId, tab, options?.openInAdjacentPanel ?? false, options?.sourcePanelId);
}

/**
 * Middleware that gives the click-time `openWorkspace*` actions a real
 * handler: after each action passes through the reducer, the matching helper
 * opens (or focuses) its panel-layout tab. Every action payload is the tuple
 * declared on the corresponding slice `createAction<...>()`.
 */
export function createWorkspaceNavigationTabMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (!action || typeof (action as { type?: unknown }).type !== "string") return result;
    const payload = (action as { payload?: unknown }).payload;
    if (!Array.isArray(payload)) return result;

    switch ((action as { type: string }).type) {
      case openWorkspaceCommitChangeset.type: {
        const [wsId, commitHash, commitMessage, options] = payload as [
          string,
          string | undefined,
          string | undefined,
          { openInAdjacentPanel?: boolean; sourcePanelId?: string } | undefined,
        ];
        if (typeof wsId === "string" && typeof commitHash === "string" && commitHash.length > 0) {
          openCommitChangesetTab(wsId, commitHash, commitMessage, options);
        }
        break;
      }
      case openWorkspaceFile.type: {
        const [wsId, filePath, options] = payload as [
          string,
          string | undefined,
          { line?: number; openInAdjacentPanel?: boolean; sourcePanelId?: string } | undefined,
        ];
        if (typeof wsId === "string" && typeof filePath === "string" && filePath.length > 0) {
          openFileTab(wsId, filePath, options);
        }
        break;
      }
      case openWorkspaceNote.type: {
        const [wsId, noteId, options] = payload as [
          string,
          string | undefined,
          { openInAdjacentPanel?: boolean; sourcePanelId?: string } | undefined,
        ];
        if (typeof wsId === "string" && typeof noteId === "string" && noteId.length > 0) {
          openNoteTab(wsId, noteId, options);
        }
        break;
      }
      case openWorkspaceDiff.type: {
        const [wsId, change, options] = payload as [
          string,
          TrackedChange | undefined,
          Parameters<typeof openDiffTab>[2],
        ];
        if (typeof wsId === "string") {
          openDiffTab(wsId, change, options);
        }
        break;
      }
    }
    return result;
  };
}
