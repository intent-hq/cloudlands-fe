import {
  clearCurrentlyViewed,
  markAsViewed,
} from "$lib/store/slices/note-read-tracking/note-read-tracking-slice";
import { workspaceClient } from "$lib/store/slices/workspace/utils/workspace.client";
import {
  ChangeStage,
  type FileChangeStatus,
  type TrackedChange,
} from "$features/file-tracking/types";
import type { WorkspaceUIContext } from "$shared/types";
import { WorkspaceId } from "$shared/types/branded-ids";
import {
  call,
  put,
  takeEvery,
} from "typed-redux-saga";
import { selectWorkspaceNavigationState } from "../workspace-navigation-selectors";
import {
  hydrateWorkspaceNavigation,
  openWorkspaceAcceptChanges,
  openWorkspaceActivityChanges,
  openWorkspaceAgentTurnChanges,
  openWorkspaceBrowser,
  openWorkspaceChangeSet,
  openWorkspaceChatChanges,
  openWorkspaceCodeReview,
  openWorkspaceCommitChangeset,
  openWorkspaceDiff,
  openWorkspaceFile,
  openWorkspaceLocalChanges,
  openWorkspaceNote,
  setWorkspaceMainPanel,
  updateWorkspaceCodeReview,
} from "../workspace-navigation-slice";

const PANEL_CHANGE_ACTIONS = [
  hydrateWorkspaceNavigation,
  setWorkspaceMainPanel,
  openWorkspaceFile,
  openWorkspaceNote,
  openWorkspaceBrowser,
  openWorkspaceAcceptChanges,
  openWorkspaceDiff,
  openWorkspaceChangeSet,
  openWorkspaceAgentTurnChanges,
  openWorkspaceActivityChanges,
  openWorkspaceChatChanges,
  openWorkspaceLocalChanges,
  openWorkspaceCommitChangeset,
  openWorkspaceCodeReview,
  updateWorkspaceCodeReview,
] as const;

type PanelChangeAction = {
  payload: [wsId: string, ...rest: unknown[]];
};

function mapTrackedChangeStatusToContextType(
  status?: FileChangeStatus,
): NonNullable<WorkspaceUIContext["diffInfo"]>["changeType"] {
  switch (status) {
    case "added":
      return "created";
    case "deleted":
      return "deleted";
    case "renamed":
      return "renamed";
    case "modified":
    default:
      return "modified";
  }
}

function getSafeDiffStat(
  stats: Partial<Record<"additions" | "deletions", unknown>> | undefined,
  key: "additions" | "deletions",
): number {
  const value = stats?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getDiffInfo(trackedChange?: TrackedChange): WorkspaceUIContext["diffInfo"] {
  if (!trackedChange) {
    return undefined;
  }

  return {
    additions: getSafeDiffStat(trackedChange.stats, "additions"),
    deletions: getSafeDiffStat(trackedChange.stats, "deletions"),
    isStaged: trackedChange.stage === ChangeStage.Staged,
    gitStatus: trackedChange.status ?? "modified",
    changeType: mapTrackedChangeStatusToContextType(trackedChange.status),
  };
}

export function* handlePanelChanged(action: PanelChangeAction) {
  const [wsId] = action.payload;
  const navState = yield* selectWorkspaceNavigationState.effect(wsId);
  const mainPanel = navState.mainPanel;

  let mainContentType: WorkspaceUIContext["mainContentType"] = "empty";
  let mainContentId: string | undefined;
  let mainContentPath: string | undefined;
  let mainContentUrl: string | undefined;
  let diffInfo: WorkspaceUIContext["diffInfo"];

  switch (mainPanel.type) {
    case "notes":
      mainContentType = "note";
      mainContentId = mainPanel.selectedNoteId;
      break;
    case "file":
      mainContentType = "file";
      mainContentId = mainPanel.selectedFile;
      mainContentPath = mainPanel.selectedFile;
      break;
    case "file-tracking-diff":
      mainContentType = "diff";
      mainContentId = mainPanel.selectedChangeId ?? mainPanel.selectedFile;
      mainContentPath = mainPanel.selectedFile;
      diffInfo = getDiffInfo(mainPanel.selectedTrackedChange);
      break;
    case "browser":
      mainContentType = "browser";
      mainContentId = mainPanel.selectedBrowserUrl;
      mainContentUrl = mainPanel.selectedBrowserUrl;
      break;
    case "source":
      mainContentType = "source";
      mainContentId = mainPanel.selectedSourceId;
      break;
  }

  yield* call([workspaceClient, workspaceClient.updateCurrentContext], WorkspaceId(wsId), {
    workspaceId: WorkspaceId(wsId),
    mainContentType,
    mainContentId,
    mainContentPath,
    mainContentUrl,
    ...(diffInfo ? { diffInfo } : {}),
    lastUpdated: new Date().toISOString(),
  });

  if (mainPanel.type === "notes" && mainPanel.selectedNoteId) {
    yield* put(markAsViewed(mainPanel.selectedNoteId));
    return;
  }

  yield* put(clearCurrentlyViewed());
}

export function* panelContextSaga() {
  for (const action of PANEL_CHANGE_ACTIONS) {
    yield* takeEvery(action, handlePanelChanged);
  }
}