import { editableText } from '$features/file/utils/file-content';
import { call, delay, put, race, take, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import type { FileContentEntry } from '../files-types';
import {
  deleteFileRequested,
  deleteFileWithUndoRequested,
  removeFileContentEntry,
  saveFileContentRequested,
  updateFileContent,
} from '../files-slice';

export const FILE_CONTENT_SAVE_DEBOUNCE_MS = 1500;

type ObservedAction = { type: string; payload?: unknown };

function isSaveFor(
  action: ObservedAction,
  workspaceId: string,
  path: string,
  absolutePath: string,
): boolean {
  if (
    ![
      saveFileContentRequested.type,
      deleteFileRequested.type,
      deleteFileWithUndoRequested.type,
    ].includes(action.type) ||
    !Array.isArray(action.payload) ||
    action.payload[0] !== workspaceId
  )
    return false;
  const requestAbsolutePath =
    action.type === saveFileContentRequested.type
      ? action.payload[2]
      : action.payload[2]?.absolutePath;
  return action.payload[1] === path || requestAbsolutePath === absolutePath;
}

function* waitForManualFileEdit(workspaceId: string, path: string) {
  while (true) {
    const edit = yield* take(updateFileContent);
    if (
      edit.payload[0] === workspaceId &&
      edit.payload[1] === path &&
      edit.payload[3]?.autoSave === false
    )
      return;
  }
}

/** The source edit watcher, bound once per host; writes remain owned by createFilesSaveSaga. */
export function createFilesAutosaveSaga<Scope>({
  selectFileContentEntry,
  admission,
}: {
  selectFileContentEntry: {
    effect: (workspaceId: string, path: string) => SagaGenerator<FileContentEntry | undefined>;
  };
  admission?: {
    /** Includes the host's current view, principal, backend, and workspace authority. */
    captureAuthority: (workspaceId: string, path: string, absolutePath: string) => string | null;
    createRequestId: () => string;
    /** Opt in only for desktop autosave; explicit-save hosts retain pending-request rejection. */
    serializeSaves?: boolean;
    retirement?: {
      /** Capture the originating view/root scope synchronously; null declines this edit. */
      captureScope: (workspaceId: string, path: string, absolutePath: string) => Scope | null;
      /** Observe every selector transition, including same-turn ABA; close owned channels in finally. */
      waitForRetirement: (scope: Scope) => SagaGenerator<void>;
    };
  };
}) {
  function isCleanup(action: ObservedAction, workspaceId: string, path: string): boolean {
    return (
      Array.isArray(action.payload) &&
      action.payload[0] === workspaceId &&
      (action.type === workspaceUnmounted.type ||
        (admission !== undefined &&
          action.type === removeFileContentEntry.type &&
          action.payload[1] === path))
    );
  }

  function* updateFileContentWorker(action: ReturnType<typeof updateFileContent>) {
    if (action.payload[3]?.autoSave === false) return;
    const [workspaceId, path] = action.payload;
    const entry = yield* selectFileContentEntry.effect(workspaceId, path);
    if (!entry?.absolutePath || entry.kind !== 'editable-text') return;
    const absolutePath = entry.absolutePath;
    // A later grant must never authorize an edit made without this host's authority.
    const authority = admission?.captureAuthority(workspaceId, path, absolutePath);
    if (admission && (!authority || entry.loading || entry.truncated)) return;
    const retirement = admission?.retirement;
    const scope = retirement?.captureScope(workspaceId, path, absolutePath);
    if (retirement && scope == null) return;
    const { elapsed } = yield* race({
      elapsed: delay(FILE_CONTENT_SAVE_DEBOUNCE_MS, true),
      ...(retirement && scope != null
        ? { retired: call(retirement.waitForRetirement, scope) }
        : {}),
      directSave: take((save: ObservedAction) => isSaveFor(save, workspaceId, path, absolutePath)),
      manualEdit: call(waitForManualFileEdit, workspaceId, path),
      cleanup: take((cleanup: ObservedAction) => isCleanup(cleanup, workspaceId, path)),
    });
    if (!elapsed) return;
    const latestEntry = yield* selectFileContentEntry.effect(workspaceId, path);
    if (
      !latestEntry?.absolutePath ||
      latestEntry.kind !== 'editable-text' ||
      (latestEntry.localContent === latestEntry.originalContent &&
        (!admission?.serializeSaves || !latestEntry.saving))
    )
      return;
    if (admission) {
      if (
        !authority ||
        latestEntry.loading ||
        latestEntry.truncated ||
        latestEntry.absolutePath !== absolutePath ||
        admission.captureAuthority(workspaceId, path, absolutePath) !== authority
      )
        return;
      yield* put(
        saveFileContentRequested(
          workspaceId,
          path,
          latestEntry.absolutePath,
          editableText(latestEntry.localContent),
          {
            requestId: admission.createRequestId(),
            authority,
            ...(admission.serializeSaves ? { serialize: true } : {}),
          },
        ),
      );
      return;
    }
    yield* put(
      saveFileContentRequested(
        workspaceId,
        path,
        latestEntry.absolutePath,
        editableText(latestEntry.localContent),
      ),
    );
  }

  return function* filesAutosaveSaga(): SagaGenerator<void> {
    // Preserve source timing: each edit waits independently and reads the latest text.
    yield* takeEvery(updateFileContent, updateFileContentWorker);
  };
}
