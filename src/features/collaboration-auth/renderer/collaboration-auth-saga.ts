import { call, take, type SagaGenerator } from 'typed-redux-saga';
import { takeLatestFromSelector } from '@themislib/themis/saga';
import {
  selectLabsGitLabEnabled,
  selectLabsMultiplayerEnabled,
  selectUserPreferencesHydrated,
} from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import { userPreferencesHydrated } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { syncCollaborationPolicy } from './collaboration-auth.client';

function* refreshPolicy(): SagaGenerator<void> {
  yield* call(syncCollaborationPolicy);
}
export function* collaborationAuthSaga(): SagaGenerator<void> {
  // Publish only settled policy. Main treats every later change as a new policy revision, so
  // a default publish followed by the hydrated GitLab choice would cancel a cold-start invite.
  if (!(yield* selectUserPreferencesHydrated.effect())) yield* take(userPreferencesHydrated);
  yield* takeLatestFromSelector(selectLabsMultiplayerEnabled, refreshPolicy);
  yield* takeLatestFromSelector(selectLabsGitLabEnabled, refreshPolicy);
}
