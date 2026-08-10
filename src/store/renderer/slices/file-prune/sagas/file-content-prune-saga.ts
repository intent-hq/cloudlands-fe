import { takeLeadingFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
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

export function* cleanupClosedFileContentEntries({
  payload,
}: SelectorChannelPayload<string[]>): SagaGenerator<void> {
  if (payload.length === 0) return;
  const workspaceId = yield* selectActiveWorkspaceId.effect();
  if (!isValidActiveWorkspaceId(workspaceId)) return;

  for (const path of payload) {
    yield* put(removeFileContentEntry(workspaceId, path));
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* fileContentPruneSaga(): SagaGenerator<void> {
  yield* cleanupClosedFileContentEntries({
    payload: yield* selectFileContentPrunePayload.effect(),
    prevPayload: null,
  });
  yield* takeLeadingFromSelector(selectFileContentPrunePayload, cleanupClosedFileContentEntries);
}
