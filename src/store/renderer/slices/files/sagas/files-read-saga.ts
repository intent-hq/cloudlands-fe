import { buffers, channel, type Channel } from 'redux-saga';
import { call, join, put, race, take, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { resolveFileBySuffix } from '$lib/services/files/resolve-file-by-suffix';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { updateFileTabPath } from '../../panel-layout/panel-layout-slice';
import { takeSingleFlightInContext } from '../../../utils/context-saga-effects';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  loadFileContentFailed,
  loadFileContentRequested,
  loadFileContentSucceeded,
  removeFileContentEntry,
} from '../files-slice';

const logger = createLogger('FilesReadSaga');

/** Keeps multi-pane restore responsive without adding an unbounded file.read burst. */
export const MAX_CONCURRENT_FILE_READS = 4;

type ReadAction = ReturnType<typeof loadFileContentRequested>;
type ReadResult =
  | { kind: 'success'; content: string; isBinary?: boolean; truncated?: boolean }
  | { kind: 'failure'; message: string; candidates?: string[] }
  | { kind: 'retarget'; path: string };

function* loadFileContentWorker(workspaceId: string, path: string): SagaGenerator<ReadResult> {
  try {
    const entry: Awaited<ReturnType<typeof appClient.files.read>> = yield* call(
      [appClient.files, appClient.files.read],
      workspaceId,
      path,
    );
    if (!entry) {
      // Not found at the workspace root — the path may be submodule- or
      // worktree-relative (see monorepo#2059). Attempt suffix resolution.
      // Candidates never include the requested path itself (the helper
      // excludes the self-match), so a single candidate is a real retarget.
      const { candidates, truncated } = yield* call(resolveFileBySuffix, workspaceId, path);
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
      content: entry.originalContent ?? entry.localContent ?? '',
      isBinary: entry.isBinary,
      truncated: entry.truncated,
    };
  } catch (error) {
    logger.error('Failed to load file content', error);
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'failure', message };
  }
}

function* applyReadResult(action: ReadAction, result: ReadResult): SagaGenerator<void> {
  const [workspaceId, path, absolutePath] = action.payload;
  if (result.kind === 'retarget') {
    yield* put(removeFileContentEntry(workspaceId, path));
    yield* put(updateFileTabPath(workspaceId, path, result.path));
  } else if (result.kind === 'failure') {
    yield* put(
      loadFileContentFailed(workspaceId, path, absolutePath, result.message, result.candidates),
    );
  } else {
    yield* put(
      loadFileContentSucceeded(
        workspaceId,
        path,
        absolutePath,
        result.content,
        result.isBinary,
        result.truncated,
      ),
    );
  }
}

function* readWithPermit(
  permits: Channel<boolean>,
  generations: Map<string, number>,
  key: string,
  generation: number,
  workspaceId: string,
  path: string,
): SagaGenerator<ReadResult | undefined> {
  let acquired = false;
  try {
    const admission = yield* race({
      permit: take(permits),
      cleanup: take(matchesWorkspaceCleanup(workspaceId)),
    });
    if (admission.cleanup) {
      clearWorkspaceGenerations(generations, workspaceId);
      return undefined;
    }
    acquired = true;
    if (generations.get(key) !== generation) return undefined;

    const read = yield* race({
      result: call(loadFileContentWorker, workspaceId, path),
      cleanup: take(matchesWorkspaceCleanup(workspaceId)),
    });
    if (read.cleanup) {
      clearWorkspaceGenerations(generations, workspaceId);
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

function matchesWorkspaceCleanup(workspaceId: string) {
  return (action: { type: string; payload?: unknown }) =>
    action.type === workspaceUnmounted.type &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId;
}

function registerReadGeneration(
  generations: Map<string, number>,
  requestGenerations: WeakMap<ReadAction, number>,
  action: ReadAction,
): string {
  const key = readKey(action);
  const generation = (generations.get(key) ?? 0) + 1;
  generations.set(key, generation);
  requestGenerations.set(action, generation);
  return key;
}

function* loadFileContentRequestWorker(
  generations: Map<string, number>,
  requestGenerations: WeakMap<ReadAction, number>,
  permits: Channel<boolean>,
  action: ReadAction,
): SagaGenerator<void> {
  const [workspaceId, path, absolutePath] = action.payload;
  if (!workspaceId || !path || typeof absolutePath !== 'string') return;
  const key = readKey(action);
  const generation = requestGenerations.get(action);
  if (!generation || generations.get(key) !== generation) return;

  const result = yield* call(
    readWithPermit,
    permits,
    generations,
    key,
    generation,
    workspaceId,
    path,
  );
  if (!result || generations.get(key) !== generation) return;

  yield* call(applyReadResult, action, result);
  if (generations.get(key) === generation) {
    generations.delete(key);
  }
}

export function* filesReadSaga(): SagaGenerator<void> {
  const generations = new Map<string, number>();
  const requestGenerations = new WeakMap<ReadAction, number>();
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
}
