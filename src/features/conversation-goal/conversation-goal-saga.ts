import { call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { goalCommandSendRequested, goalSetRequested } from './conversation-goal-actions';
import { requestGoalCommand, requestSetGoal } from './goal-requests';

function* sendGoalCommand(
  action: ReturnType<typeof goalCommandSendRequested>,
): SagaGenerator<void> {
  const [workspaceId, agentId, content] = action.payload;
  const outcome = yield* call(requestGoalCommand, workspaceId, agentId, content);
  yield* put(action.success(outcome));
}

function* setGoal(action: ReturnType<typeof goalSetRequested>): SagaGenerator<void> {
  const [workspaceId, agentId, goal] = action.payload;
  const outcome = yield* call(requestSetGoal, workspaceId, agentId, goal);
  yield* put(action.success(outcome));
}

/** Goal writes resolve with their outcome; failures are shown inline by the caller. */
export function* conversationGoalSaga(): SagaGenerator<void> {
  yield* takeEvery(goalCommandSendRequested, sendGoalCommand);
  yield* takeEvery(goalSetRequested, setGoal);
}
