import { put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import type { TrackedChange } from '$features/file-tracking/types';
import { m } from '$shared/paraglide/messages.js';
import { selectPanel } from '../../panel-layout/panel-layout-selectors';
import { openTab, openTabInAdjacentOrSplit } from '../../panel-layout/panel-layout-slice';
import type { PanelTab } from '../../panel-layout/panel-layout-types';
import { selectNoteById } from '../../workspace-notes/workspace-notes-selectors';
import {
  openWorkspaceCommitChangeset,
  openWorkspaceDiff,
  openWorkspaceFile,
  openWorkspaceNote,
} from '../workspace-navigation-slice';

function* openWorkspaceTab(
  workspaceId: string,
  tab: Omit<PanelTab, 'id'>,
  adjacent: boolean,
  sourcePanelId?: string,
): SagaGenerator<void> {
  if (adjacent) {
    yield* put(openTabInAdjacentOrSplit(workspaceId, tab, sourcePanelId, { force: true }));
    return;
  }
  yield* put(openTab(workspaceId, tab, sourcePanelId, undefined, true));
}

function commitTitle(commitHash: string, commitMessage?: string): string {
  const shortHash = commitHash.substring(0, 7);
  if (!commitMessage) return m.layout_navigation_commit_title({ hash: shortHash });
  const message =
    commitMessage.length > 20 ? `${commitMessage.substring(0, 20)}...` : commitMessage;
  return `${shortHash}: ${message}`;
}

function* openCommit(action: ReturnType<typeof openWorkspaceCommitChangeset>): SagaGenerator<void> {
  const [workspaceId, commitHash, commitMessage, options] = action.payload;
  if (!workspaceId || !commitHash) return;
  yield* openWorkspaceTab(
    workspaceId,
    {
      type: 'changes',
      title: commitTitle(commitHash, commitMessage),
      workspaceId,
      closable: true,
      data: { commitHash, ...(commitMessage ? { commitMessage } : {}) },
    },
    options?.openInAdjacentPanel ?? false,
    options?.sourcePanelId,
  );
}

function* openFile(action: ReturnType<typeof openWorkspaceFile>): SagaGenerator<void> {
  const [workspaceId, filePath, options] = action.payload;
  if (!workspaceId || !filePath) return;
  yield* openWorkspaceTab(
    workspaceId,
    {
      type: 'file',
      title: filePath.split('/').pop() || m.layout_tabTypes_file_title(),
      filePath,
      workspaceId,
      closable: true,
      ...(options?.line ? { data: { line: options.line, jumpTimestamp: Date.now() } } : {}),
    },
    options?.openInAdjacentPanel ?? false,
    options?.sourcePanelId,
  );
}

function* openNote(action: ReturnType<typeof openWorkspaceNote>): SagaGenerator<void> {
  const [workspaceId, noteId, options] = action.payload;
  if (!workspaceId || !noteId) return;
  let adjacent = options?.openInAdjacentPanel ?? false;
  if (!adjacent && options?.sourcePanelId) {
    const panel = yield* selectPanel.effect(workspaceId, options.sourcePanelId);
    const activeTab = panel?.tabs.find((tab) => tab.id === panel.activeTabId);
    adjacent = activeTab?.type === 'agent';
  }
  const note = yield* selectNoteById.effect(workspaceId, noteId);
  yield* openWorkspaceTab(
    workspaceId,
    {
      type: 'note',
      title: note?.title || noteId,
      noteId,
      workspaceId,
      closable: true,
    },
    adjacent,
    options?.sourcePanelId,
  );
}

function* openDiff(action: ReturnType<typeof openWorkspaceDiff>): SagaGenerator<void> {
  const [workspaceId, change, options] = action.payload;
  if (!workspaceId) return;
  const filePath = options?.filePath || change?.file || change?.relativePath;
  if (!filePath) return;
  yield* openWorkspaceTab(
    workspaceId,
    {
      type: 'diff',
      title: filePath.split('/').pop() || m.layout_tabTypes_diff_title(),
      diffPath: filePath,
      workspaceId,
      closable: true,
      data: {
        change: change as TrackedChange,
        ...(options?.branchBaseRef ? { branchBaseRef: options.branchBaseRef } : {}),
        ...(options?.branchBaseCommitSha
          ? { branchBaseCommitSha: options.branchBaseCommitSha }
          : {}),
      },
    },
    options?.openInAdjacentPanel ?? false,
    options?.sourcePanelId,
  );
}

export function* workspaceNavigationTabSaga(): SagaGenerator<void> {
  yield* takeEvery(openWorkspaceCommitChangeset, openCommit);
  yield* takeEvery(openWorkspaceFile, openFile);
  yield* takeEvery(openWorkspaceNote, openNote);
  yield* takeEvery(openWorkspaceDiff, openDiff);
}
