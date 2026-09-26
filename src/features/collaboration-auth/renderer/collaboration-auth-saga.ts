import { call, type SagaGenerator } from 'typed-redux-saga';
import { takeLatestFromSelector } from '@augmentcode/themis/saga';
import {
  selectLabsGitLabEnabled,
  selectLabsMultiplayerEnabled,
} from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import { syncCollaborationPolicy } from './collaboration-auth.client';

function* refreshPolicy(): SagaGenerator<void> {
  yield* call(syncCollaborationPolicy);
}
export function* collaborationAuthSaga(): SagaGenerator<void> {
  yield* takeLatestFromSelector(selectLabsMultiplayerEnabled, refreshPolicy);
  yield* takeLatestFromSelector(selectLabsGitLabEnabled, refreshPolicy);
}
