import type { FileContent } from '../files-types';
import { editableText } from '$features/file/utils/file-content';
import { buffers, channel, type Channel } from 'redux-saga';
import { call, join, put, race, take, type SagaGenerator } from 'typed-redux-saga';

import type { StoreAction } from '@themislib/themis/types';
import type { FilesClient } from '$lib/client/app-client';
import type { SuffixResolution } from '$lib/services/files/file-suffix-resolver';
import { mutationErrorMessage } from '$lib/client/live/backend-mutation';
import { m } from '$shared/paraglide/messages.js';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  loadFileContentFailed,
  loadFileContentRequested,
  loadFileContentSucceeded,
  removeFileContentEntry,
} from '../files-slice';

/** Keeps multi-pane restore responsive without adding an unbounded file.read burst. */
export const MAX_CONCURRENT_FILE_READS = 4;

type ReadAction = ReturnType<typeof loadFileContentRequested>;
type ReadResult =
  | { kind: 'success'; content: FileContent; truncated?: boolean }
  | { kind: 'failure'; message: string; candidates?: string[] }
  | { kind: 'retarget'; path: string };

/** The canonical file cache reader, bound once by each renderer's lifetime owner. */
export function createFilesReadSaga({
  files,
  resolveFileBySuffix,
  admission,
  onRetarget,
  onError,
}: {
  files: Pick<FilesClient, 'read'>;
  resolveFileBySuffix: (
    workspaceId: string,
    path: string,
    isCurrent?: () => boolean,
  ) => Promise<SuffixResolution>;
  admission?: {
    /** Read the current owning selector directly, including its authority epoch. */
    readCurrentContext: (workspaceId: string) => string | null;
    /** Synchronous host Store dispatch; checked at the publication boundary. */
    dispatch: (action: StoreAction<unknown>) => unknown;
  };
  /** Host navigation callback (or source saga), after retiring the old cache entry. */
  onRetarget: (workspaceId: string, path: string, resolved: string) => unknown;
  onError?: (error: unknown) => void;
}) {
  function* loadFileContentWorker(
    workspaceId: string,
    path: string,
    isCurrent: () => boolean,
    gitRoot?: { id: string; relativePath: string },
  ): SagaGenerator<ReadResult | undefined> {
    try {
      const entry = yield* call((): ReturnType<FilesClient['read']> => {
        if (!isCurrent()) return Promise.resolve(null);
        return gitRoot
          ? files.read(workspaceId, gitRoot.relativePath, { gitRootId: gitRoot.id })
          : files.read(workspaceId, path);
      });
      if (!isCurrent()) return undefined;
      if (!entry) {
        if (gitRoot) return { kind: 'failure', message: m.files_read_notFound_error() };
        // Not found at the workspace root — the path may be submodule- or
        // worktree-relative (see monorepo#2059). Attempt suffix resolution.
        // Candidates never include the requested path itself (the helper
        // excludes the self-match), so a single candidate is a real retarget.
        const { candidates, truncated } = yield* call((): Promise<SuffixResolution> =>
          isCurrent()
            ? resolveFileBySuffix(workspaceId, path, isCurrent)
            : Promise.resolve({ candidates: [], truncated: true }),
        );
        if (!truncated && candidates.length === 1) {
          // Provably unique match (search not truncated): retarget open file
          // tabs to the resolved path; the tab component re-issues the read
          // (and future saves) against it. A truncated search may hide further
          // matches, so it is treated as ambiguous below instead.
          // The read request carries no tab identity, so this retarget is
          // path-scoped: every tab showing the not-found path shares the same
          // failed read and moves to the resolved path together.
          return { kind: 'retarget', path: candidates[0] };
        }
        return { kind: 'failure', message: m.files_read_notFound_error(), candidates };
      }
      return {
        kind: 'success',
        content:
          entry.kind === 'editable-text'
            ? editableText(entry.originalContent)
            : entry.kind === 'restorable-snapshot'
              ? { kind: 'restorable-snapshot', content: entry.originalContent, isBinary: true }
              : { kind: 'preview-only', isBinary: entry.isBinary },
        truncated: entry.truncated,
      };
    } catch (error) {
      if (!isCurrent()) return undefined;
      onError?.(error);
      const message = mutationErrorMessage(error);
      return { kind: 'failure', message };
    }
  }

  function* publish(
    action: StoreAction<unknown>,
    isCurrent: () => boolean,
  ): SagaGenerator<boolean> {
    if (!admission) {
      if (!isCurrent()) return false;
      yield* put(action);
      return true;
    }
    return yield* call(() => {
      if (!isCurrent()) return false;
      admission.dispatch(action);
      return true;
    });
  }

  function* applyReadResult(
    action: ReadAction,
    result: ReadResult,
    isCurrent: () => boolean,
  ): SagaGenerator<void> {
    const [workspaceId, path, absolutePath] = action.payload;
    if (result.kind === 'retarget') {
      if (!(yield* publish(removeFileContentEntry(workspaceId, path), isCurrent))) return;
      yield* call(() => {
        if (isCurrent()) return onRetarget(workspaceId, path, result.path);
      });
    } else if (result.kind === 'failure') {
      yield* publish(
        loadFileContentFailed(workspaceId, path, absolutePath, result.message, result.candidates),
        isCurrent,
      );
    } else {
      yield* publish(
        loadFileContentSucceeded(workspaceId, path, absolutePath, result.content, result.truncated),
        isCurrent,
      );
    }
  }

  function* readWithPermit(
    permits: Channel<boolean>,
    generations: Map<string, number>,
    key: string,
    generation: number,
    isCurrent: () => boolean,
    workspaceId: string,
    path: string,
    gitRoot?: { id: string; relativePath: string },
  ): SagaGenerator<ReadResult | undefined> {
    if (!isCurrent()) return undefined;
    let acquired = false;
    try {
      const admission = yield* race({
        permit: take(permits),
        cleanup: take(matchesReadCleanup(workspaceId, path)),
      });
      if (admission.cleanup) {
        if (admission.cleanup.type === workspaceUnmounted.type)
          clearWorkspaceGenerations(generations, workspaceId);
        else generations.delete(key);
        return undefined;
      }
      acquired = true;
      if (generations.get(key) !== generation || !isCurrent()) return undefined;

      const read = yield* race({
        result: call(loadFileContentWorker, workspaceId, path, isCurrent, gitRoot),
        cleanup: take(matchesReadCleanup(workspaceId, path)),
      });
      if (read.cleanup) {
        if (read.cleanup.type === workspaceUnmounted.type)
          clearWorkspaceGenerations(generations, workspaceId);
        else generations.delete(key);
        return undefined;
      }
      return read.result;
    } finally {
      if (acquired) permits.put(true);
    }
  }

  function readKey(action: ReadAction): string {
    return JSON.stringify([action.payload[0], action.payload[1]]);
  }

  function clearWorkspaceGenerations(generations: Map<string, number>, workspaceId: string): void {
    for (const key of generations.keys()) {
      const [keyWorkspaceId] = JSON.parse(key) as [string, string];
      if (keyWorkspaceId === workspaceId) generations.delete(key);
    }
  }

  function matchesReadCleanup(workspaceId: string, path: string) {
    return (action: { type: string; payload?: unknown }) =>
      Array.isArray(action.payload) &&
      action.payload[0] === workspaceId &&
      (action.type === workspaceUnmounted.type ||
        (action.type === removeFileContentEntry.type && action.payload[1] === path));
  }

  function registerReadGeneration(
    generations: Map<string, number>,
    requestGenerations: WeakMap<
      ReadAction,
      { generation: number; context: string | null | undefined }
    >,
    action: ReadAction,
  ): string {
    const key = readKey(action);
    const generation = (generations.get(key) ?? 0) + 1;
    generations.set(key, generation);
    requestGenerations.set(action, {
      generation,
      context: admission?.readCurrentContext(action.payload[0]),
    });
    return key;
  }

  function* loadFileContentRequestWorker(
    generations: Map<string, number>,
    requestGenerations: WeakMap<
      ReadAction,
      { generation: number; context: string | null | undefined }
    >,
    permits: Channel<boolean>,
    action: ReadAction,
  ): SagaGenerator<void> {
    const [workspaceId, path, absolutePath] = action.payload;
    const key = readKey(action);
    const request = requestGenerations.get(action);
    if (!request) return;
    const { generation, context } = request;
    let active = true;
    const isCurrent = () =>
      active &&
      generations.get(key) === generation &&
      (!admission || admission.readCurrentContext(workspaceId) === context);
    try {
      if (!workspaceId || !path || typeof absolutePath !== 'string' || context === null) return;
      if (!isCurrent()) return;

      const result = yield* call(
        readWithPermit,
        permits,
        generations,
        key,
        generation,
        isCurrent,
        workspaceId,
        path,
        action.payload[3]?.gitRoot,
      );
      if (!result || !isCurrent()) return;

      yield* call(applyReadResult, action, result, isCurrent);
    } finally {
      active = false;
      if (generations.get(key) === generation) generations.delete(key);
    }
  }

  return function* filesReadSaga(): SagaGenerator<void> {
    const generations = new Map<string, number>();
    const requestGenerations = new WeakMap<
      ReadAction,
      { generation: number; context: string | null | undefined }
    >();
    const permits = channel<boolean>(buffers.fixed(MAX_CONCURRENT_FILE_READS));
    for (let index = 0; index < MAX_CONCURRENT_FILE_READS; index += 1) permits.put(true);

    try {
      const watcher = yield* takeSingleFlightInContext(
        loadFileContentRequested,
        (action) => registerReadGeneration(generations, requestGenerations, action),
        loadFileContentRequestWorker,
        generations,
        requestGenerations,
        permits,
      );
      yield* join(watcher);
    } finally {
      generations.clear();
      permits.close();
    }
  };
}
