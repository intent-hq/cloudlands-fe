import { takeEveryFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import { put, type SagaGenerator } from 'typed-redux-saga';

import { removeFileContentEntry } from '../../files/files-slice';
import { selectFileContentPrunePayload } from '../../panel-layout/panel-layout-selectors';
import { selectActiveWorkspaceId } from '../../workspace/workspace-selectors';

function isValidActiveWorkspaceId(workspaceId: string | null): workspaceId is string {
  return (
    !!workspaceId &&
    workspaceId !== 'new' &&
    !workspaceId.startsWith('optimistic-') &&
    workspaceId !== 'undefined'
  );
}

export function* cleanupClosedFileContentEntries(
  { payload }: SelectorChannelPayload<string[]>,
  pendingPrunes: Set<string> = new Set(),
): SagaGenerator<void> {
  if (payload.length === 0) return;
  const workspaceId = yield* selectActiveWorkspaceId.effect();
  if (!isValidActiveWorkspaceId(workspaceId)) return;

  const paths = payload.filter((path) => {
    const key = `${workspaceId}\u0000${path}`;
    if (pendingPrunes.has(key)) return false;
    pendingPrunes.add(key);
    return true;
  });
  try {
    for (const path of paths) {
      yield* put(removeFileContentEntry(workspaceId, path));
    }
  } finally {
    for (const path of paths) pendingPrunes.delete(`${workspaceId}\u0000${path}`);
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* fileContentPruneSaga(): SagaGenerator<void> {
  const pendingPrunes = new Set<string>();
  yield* cleanupClosedFileContentEntries(
    { payload: yield* selectFileContentPrunePayload.effect(), prevPayload: null },
    pendingPrunes,
  );
  yield* takeEveryFromSelector(selectFileContentPrunePayload, function* (payload) {
    yield* cleanupClosedFileContentEntries(payload, pendingPrunes);
  });
}