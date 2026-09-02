import { call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import type { TrackedChange } from '$features/file-tracking/types';
import {
  downloadAttachment,
  getAttachmentInfo,
  type AttachmentInfo,
} from '$lib/components/chat/input/context-api';
import { createLogger } from '$lib/utils/client-logger';
import { isBinaryExtension } from '$shared/binary-file-extensions';
import { m } from '$shared/paraglide/messages.js';
import {
  openTab,
  openTabInAdjacentOrSplit,
  openTabInRightmostColumnRequested,
} from '../../panel-layout/panel-layout-slice';
import { selectFocusedPanelId } from '../../panel-layout/panel-layout-selectors';
import type { PanelTab } from '../../panel-layout/panel-layout-types';
import { selectNoteById } from '../../workspace-notes/workspace-notes-selectors';
import {
  chatChangesDedupId,
  openWorkspaceActivityChanges,
  openWorkspaceAttachment,
  openWorkspaceBrowser,
  openWorkspaceChatChanges,
  openWorkspaceCodeReview,
  openWorkspaceCommitChangeset,
  openWorkspaceDiff,
  openWorkspaceFile,
  openWorkspaceLocalChanges,
  openWorkspaceNote,
} from '../workspace-navigation-slice';

const logger = createLogger('WorkspaceNavigationTabSaga');

function* openWorkspaceTab(
  workspaceId: string,
  tab: Omit<PanelTab, 'id'>,
  adjacent: boolean,
  sourcePanelId?: string,
  allowDuplicate?: boolean,
): SagaGenerator<void> {
  if (adjacent) {
    yield* put(
      openTabInAdjacentOrSplit(workspaceId, tab, sourcePanelId, {
        force: true,
        ...(allowDuplicate ? { allowDuplicate } : {}),
      }),
    );
    return;
  }
  const targetPanelId =
    sourcePanelId ?? (yield* selectFocusedPanelId.effect(workspaceId)) ?? undefined;
  yield* put(
    targetPanelId
      ? openTab(workspaceId, tab, targetPanelId, undefined, true)
      : openTabInRightmostColumnRequested(workspaceId, tab, { force: true }),
  );
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
      data: {
        commitHash,
        ...(commitMessage ? { commitMessage } : {}),
        ...(options?.gitRootId ? { gitRootId: options.gitRootId } : {}),
      },
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
    options?.openInAdjacentPanel ?? false,
    options?.sourcePanelId,
    options?.openInNewAdjacentPanel ?? false,
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
        ...(options?.gitRootId ? { gitRootId: options.gitRootId } : {}),
        ...(options?.gitRootPath ? { gitRootPath: options.gitRootPath } : {}),
      },
    },
    options?.openInAdjacentPanel ?? false,
    options?.sourcePanelId,
  );
}

function* openBrowser(action: ReturnType<typeof openWorkspaceBrowser>): SagaGenerator<void> {
  const [workspaceId, url] = action.payload;
  if (!workspaceId || !url) return;
  yield* openWorkspaceTab(
    workspaceId,
    {
      type: 'browser',
      title: m.layout_tabTypes_browser_title(),
      browserUrl: url,
      workspaceId,
      closable: true,
    },
    false,
  );
}

function* openLocalChanges(
  action: ReturnType<typeof openWorkspaceLocalChanges>,
): SagaGenerator<void> {
  const [workspaceId, options] = action.payload;
  if (!workspaceId) return;
  yield* openWorkspaceTab(
    workspaceId,
    {
      type: 'local-changes',
      title: m.layout_presetExecutor_allChanges_title(),
      workspaceId,
      closable: true,
      data: { gitRootId: options?.gitRootId },
    },
    false,
  );
}

function* openChatChanges(
  action: ReturnType<typeof openWorkspaceChatChanges>,
): SagaGenerator<void> {
  const [workspaceId, changes, title, options] = action.payload;
  if (!workspaceId || !changes?.length) return;
  const tabTitle = title || m.layout_tabTypes_chatChanges_title();
  const messageId = chatChangesDedupId(options);
  yield* openWorkspaceTab(
    workspaceId,
    {
      type: 'chat-changes',
      title: tabTitle,
      workspaceId,
      closable: true,
      data: {
        changes,
        title: tabTitle,
        messageId,
        ...(options?.isAggregate !== undefined ? { isAggregate: options.isAggregate } : {}),
        ...(options?.agentId ? { agentId: options.agentId } : {}),
        ...(options?.turnNumber !== undefined ? { turnNumber: options.turnNumber } : {}),
      },
    },
    false,
    options?.sourcePanelId,
  );
}

function* openActivityChanges(
  action: ReturnType<typeof openWorkspaceActivityChanges>,
): SagaGenerator<void> {
  const [workspaceId, event] = action.payload;
  if (!workspaceId || !event) return;
  yield* openWorkspaceTab(
    workspaceId,
    {
      type: 'activity-changes',
      title: m.layout_tabTypes_activityChanges_title(),
      workspaceId,
      closable: true,
      data: { event },
    },
    false,
  );
}

function* openCodeReview(action: ReturnType<typeof openWorkspaceCodeReview>): SagaGenerator<void> {
  const [workspaceId, review] = action.payload;
  if (!workspaceId) return;
  yield* openWorkspaceTab(
    workspaceId,
    {
      type: 'code-review',
      title: m.layout_tabTypes_codeReview_title(),
      workspaceId,
      closable: true,
      data: { ...review },
    },
    false,
  );
}

// Attachment-reference chip click: resolve the registry row by attachmentId
// (`file.getAttachmentInfo`, PROTOCOL §5.9) and open the stored
// workspace-relative path in a file tab — except binary/non-editor types
// (zip, images, archives…), which prompt a native save dialog instead of a
// broken editor tab (monorepo#2458). A missing file (deleted from disk
// out-of-band) or a failed lookup surfaces a toast — never a crash.
function* openAttachment(action: ReturnType<typeof openWorkspaceAttachment>): SagaGenerator<void> {
  const [workspaceId, attachmentId, fileName] = action.payload;
  if (!workspaceId || !attachmentId) return;
  try {
    const info: AttachmentInfo = yield* call(getAttachmentInfo, attachmentId);
    if (!info.exists) {
      const { toast } = yield* call(() => import('svelte-sonner'));
      toast.error(m.chat_chatMessage_attachmentMissing_error({ name: info.fileName }));
      return;
    }
    if (isBinaryExtension(info.fileName) || isBinaryExtension(info.path)) {
      // Own the error surface here so a thrown IPC/bridge failure shows the
      // download-failed toast, not the outer "failed to open" one.
      try {
        const result = yield* call(downloadAttachment, workspaceId, info.path, info.fileName);
        const { toast } = yield* call(() => import('svelte-sonner'));
        if (result.success && result.data?.filePath) {
          toast.success(
            m.chat_chatMessage_attachmentDownloaded_toast({
              name: info.fileName,
              filePath: result.data.filePath,
            }),
          );
        } else if (!result.canceled) {
          toast.error(
            result.error?.message ||
              m.chat_chatMessage_attachmentDownloadFailed_error({ name: info.fileName }),
          );
        }
      } catch (error) {
        logger.error('Failed to download attachment', { attachmentId, error });
        const { toast } = yield* call(() => import('svelte-sonner'));
        toast.error(m.chat_chatMessage_attachmentDownloadFailed_error({ name: info.fileName }));
      }
      return;
    }
    yield* put(openWorkspaceFile(workspaceId, info.path));
  } catch (error) {
    logger.error('Failed to resolve attachment', { attachmentId, error });
    const { toast } = yield* call(() => import('svelte-sonner'));
    toast.error(m.chat_chatMessage_attachmentOpenFailed_error({ name: fileName }));
  }
}

export function* workspaceNavigationTabSaga(): SagaGenerator<void> {
  yield* takeEvery(openWorkspaceActivityChanges, openActivityChanges);
  yield* takeEvery(openWorkspaceBrowser, openBrowser);
  yield* takeEvery(openWorkspaceChatChanges, openChatChanges);
  yield* takeEvery(openWorkspaceCodeReview, openCodeReview);
  yield* takeEvery(openWorkspaceCommitChangeset, openCommit);
  yield* takeEvery(openWorkspaceFile, openFile);
  yield* takeEvery(openWorkspaceLocalChanges, openLocalChanges);
  yield* takeEvery(openWorkspaceNote, openNote);
  yield* takeEvery(openWorkspaceDiff, openDiff);
  yield* takeEvery(openWorkspaceAttachment, openAttachment);
}
