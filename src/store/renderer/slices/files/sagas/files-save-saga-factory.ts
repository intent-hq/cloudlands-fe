import type { StoreAction } from '@themislib/themis/types';
import { call, cancelled, put, race, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import type { FilesClient } from '$lib/client/app-client';
import type { FileWriteResult } from '$lib/client/file-write-types';
import { stripWorkspacePrefix } from '$lib/utils/file-utils';
import { isAbsolutePath } from '$lib/utils/path-utils';
import { m } from '$shared/paraglide/messages.js';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import type { FileContentEntry, FileSaveOperation } from '../files-types';
import {
  fileSaveOperationQueued,
  fileSaveOperationStarted,
  fileSaveOperationSettled,
  loadFileContentSucceeded,
  removeFileContentEntry,
  saveFileContentFailed,
  saveFileContentRequested,
  saveFileContentSucceeded,
} from '../files-slice';
import { serializeFileMutation } from '../utils/serialize-file-mutation';

/** Canonical save watcher; the host owns authority and Store access, never another queue. */
export function createFilesSaveSaga({
  files,
  readEntries,
  resolveWorkspacePath,
  admission,
  maxBytes,
  onError,
}: {
  files: Pick<FilesClient, 'write'>;
  readEntries: (workspaceId: string) => FileContentEntry[];
  resolveWorkspacePath: (workspaceId: string) => string;
  /** Optional host budget, measured in UTF-8 bytes for both complete original and sent text. */
  maxBytes?: number;
  admission?: {
    captureAuthority: (workspaceId: string, path: string, absolutePath: string) => string | null;
    /** Stable same-owner/backend/root identity; may survive a transport reconnect, never departure. */
    capturePublicationAuthority?: (
      workspaceId: string,
      path: string,
      absolutePath: string,
    ) => string | null;
    readOperation: (requestId: string) => FileSaveOperation | undefined;
    readOperations: (workspaceId: string, path: string) => FileSaveOperation[];
    /** Synchronous dispatch is required at transport admission and publication boundaries. */
    dispatch: (action: StoreAction<unknown>) => unknown;
  };
  onError?: (error: unknown) => void;
}) {
  function* saveWorker(action: ReturnType<typeof saveFileContentRequested>): SagaGenerator<void> {
    const [workspaceId, path, absolutePath, content, options] = action.payload;
    const relativePath = stripWorkspacePrefix(
      path,
      isAbsolutePath(path) ? resolveWorkspacePath(workspaceId) : '',
    );
    let active = true;
    let dispatched = false;
    const matchingEntries = () =>
      readEntries(workspaceId).filter(
        (entry) =>
          entry.path === path ||
          entry.path === relativePath ||
          entry.path === absolutePath ||
          entry.absolutePath === absolutePath,
      );
    const initial = matchingEntries();
    let becameBinary = initial.some((entry) => entry.isBinary);
    let becamePreview = initial.some((entry) => entry.kind === 'read-only-text' || entry.truncated);
    const isCurrent = () =>
      active &&
      (!admission ||
        (!!options &&
          admission.captureAuthority(workspaceId, path, absolutePath) === options.authority));
    const publicationAuthority = admission?.capturePublicationAuthority?.(
      workspaceId,
      path,
      absolutePath,
    );
    const canPublish = () =>
      active &&
      (admission?.capturePublicationAuthority
        ? publicationAuthority != null &&
          admission.capturePublicationAuthority(workspaceId, path, absolutePath) ===
            publicationAuthority
        : isCurrent());
    const withinBudget = (entries: FileContentEntry[]) =>
      maxBytes === undefined ||
      (new TextEncoder().encode(content.content).byteLength <= maxBytes &&
        entries.every(
          (entry) =>
            typeof entry.originalContent !== 'string' ||
            new TextEncoder().encode(entry.originalContent).byteLength <= maxBytes,
        ));
    const currentEntry = () => readEntries(workspaceId).find((entry) => entry.path === path);
    const assertSafe = () => {
      const entries = matchingEntries();
      if (!withinBudget(entries)) throw new Error(m.editor_codeEditor_fileTooLarge_title());
      if (becameBinary || entries.some((entry) => entry.isBinary))
        throw new Error(m.editor_fileViewer_binary_label());
      if (
        becamePreview ||
        entries.some((entry) => entry.kind === 'read-only-text' || entry.truncated)
      )
        throw new Error(m.files_read_previewReadOnly_error());
      if (admission) {
        const entry = currentEntry();
        if (
          !isCurrent() ||
          !entry ||
          entry.kind !== 'editable-text' ||
          entry.loading ||
          entry.absolutePath !== absolutePath ||
          entry.truncated ||
          entry.isBinary
        )
          throw new Error(m.ui_reversibleActions_cancelled_message());
      }
    };
    const observeRead = ({ payload }: ReturnType<typeof loadFileContentSucceeded>) => {
      if (
        payload[0] === workspaceId &&
        (payload[1] === path ||
          payload[1] === relativePath ||
          payload[1] === absolutePath ||
          payload[2] === absolutePath)
      ) {
        if (
          (payload[3].kind === 'restorable-snapshot' || payload[3].kind === 'preview-only') &&
          payload[3].isBinary
        )
          becameBinary = true;
        if (payload[3].kind === 'read-only-text' || payload[4]) becamePreview = true;
      }
    };

    if (admission) {
      // An unguarded action cannot opt a guarded host back into source autosave policy.
      if (!options || !options.requestId || !options.authority) return;
      if (admission.readOperation(options.requestId)) return;
      const existing = admission.readOperations(workspaceId, path);
      const blocked = existing.some(
        (operation) =>
          operation.status === 'queued' ||
          operation.status === 'running' ||
          operation.status === 'uncertain',
      );
      const entry = currentEntry();
      if (
        blocked ||
        !isCurrent() ||
        (admission.capturePublicationAuthority !== undefined && publicationAuthority == null) ||
        entry?.kind !== 'editable-text' ||
        entry.loading ||
        entry.localContent !== content.content ||
        entry.absolutePath !== absolutePath ||
        becameBinary ||
        becamePreview ||
        !withinBudget(initial)
      ) {
        admission.dispatch(
          fileSaveOperationQueued({
            ...options,
            workspaceId,
            path,
            absolutePath,
            status: 'cancelled',
            error: m.ui_reversibleActions_cancelled_message(),
          }),
        );
        return;
      }
      admission.dispatch(
        fileSaveOperationQueued({ ...options, workspaceId, path, absolutePath, status: 'queued' }),
      );
    } else if (options) {
      // Explicit-save options require an authority-aware host.
      return;
    }

    const executeExplicit = async (mutationPath: string): Promise<FileWriteResult> => {
      if (!admission || !options) throw new Error(m.ui_reversibleActions_cancelled_message());
      let result: FileWriteResult;
      try {
        assertSafe();
        result = await files.write(workspaceId, mutationPath, content, {
          onDispatch: () => {
            assertSafe();
            // Hosts may resolve a route asynchronously. Recheck after that resolution,
            // immediately before wire dispatch, and record the irreversible boundary.
            if (admission.readOperation(options.requestId)?.status !== 'queued')
              throw new Error(m.ui_reversibleActions_cancelled_message());
            dispatched = true;
            admission.dispatch(fileSaveOperationStarted(options.requestId));
          },
        });
      } catch (error) {
        onError?.(error);
        result = {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          outcome: dispatched ? 'uncertain' : 'failed',
        };
      }
      const status = result.success
        ? 'succeeded'
        : !dispatched && !isCurrent()
          ? 'cancelled'
          : result.outcome === 'failed'
            ? 'failed'
            : 'uncertain';
      // Operation settlement belongs to transport lifetime; content publication belongs
      // to the original view/authority. Neither departure nor reconnect replays the write.
      if (canPublish()) {
        if (result.success)
          admission.dispatch(
            saveFileContentSucceeded(workspaceId, path, content, options.requestId),
          );
        else
          admission.dispatch(
            saveFileContentFailed(
              workspaceId,
              path,
              result.error ?? m.fileExplorer_layout_saveFailed_error(),
              options.requestId,
            ),
          );
      }
      admission.dispatch(fileSaveOperationSettled(options.requestId, status, result.error));
      return result;
    };
    const execute = (mutationPath: string): Promise<FileWriteResult> => {
      if (admission) return executeExplicit(mutationPath);
      assertSafe();
      return files.write(workspaceId, mutationPath, content);
    };
    try {
      const result = yield* call(
        serializeFileMutation<FileWriteResult>,
        workspaceId,
        relativePath,
        execute,
        observeRead,
      );
      if (admission) return;
      if (result.success) yield* put(saveFileContentSucceeded(workspaceId, path, content));
      else
        yield* put(
          saveFileContentFailed(
            workspaceId,
            path,
            result.error ?? m.fileExplorer_layout_saveFailed_error(),
          ),
        );
    } catch (error) {
      onError?.(error);
      if (!admission)
        yield* put(
          saveFileContentFailed(
            workspaceId,
            path,
            error instanceof Error ? error.message : String(error),
          ),
        );
    } finally {
      if (yield* cancelled()) {
        active = false;
        if (admission && options && !dispatched)
          admission.dispatch(fileSaveOperationSettled(options.requestId, 'cancelled'));
      }
    }
  }

  function matchesCleanup(workspaceId: string, path: string) {
    return (event: { type: string; payload?: unknown }) =>
      Array.isArray(event.payload) &&
      event.payload[0] === workspaceId &&
      (event.type === workspaceUnmounted.type ||
        (admission !== undefined &&
          event.type === removeFileContentEntry.type &&
          event.payload[1] === path));
  }

  function* saveActionWorker(action: ReturnType<typeof saveFileContentRequested>) {
    const [workspaceId, path] = action.payload;
    yield* race({
      save: call(saveWorker, action),
      cleanup: take(matchesCleanup(workspaceId, path)),
    });
  }

  return function* filesSaveSaga(): SagaGenerator<void> {
    yield* takeEvery(saveFileContentRequested, saveActionWorker);
  };
}
