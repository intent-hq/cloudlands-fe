import { v4 as uuid } from 'uuid';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  takeEveryFromSelector,
  takeLatestFromSelector,
  type SelectorChannelPayload,
} from '@themislib/themis/saga';
import {
  all,
  call,
  cancel,
  join,
  put,
  race,
  take,
  select,
  type SagaGenerator,
} from 'typed-redux-saga';
import type { Task } from 'redux-saga';
import { workspaceDiscussionClient, discussionError } from '$lib/client/live/workspace-discussion';
import {
  DISCUSSION_MAX_BODY_BYTES,
  DISCUSSION_PAGE_SIZE,
} from '$shared/types/workspace-discussion';
import { takeLeadingInContext } from '../../../utils/context-saga-effects';
import {
  discussionContextChanged,
  discussionWorkspacesChanged,
  discussionRequested,
  discussionOlderRequested,
  discussionSendRequested,
  discussionRetryRequested,
  discussionLoadStarted,
  discussionPageReceived,
  discussionLoadFinished,
  discussionSendStarted,
  discussionSendSucceeded,
  discussionSendFailed,
  type DiscussionTarget,
} from '../workspace-discussion-slice';
import {
  selectDiscussionContext,
  selectDiscussionOwner,
  selectDiscussionWorkspaceIds,
  selectDiscussionTarget,
  selectWorkspaceDiscussion,
  selectDiscussionReady,
  selectDiscussionRequestedIds,
  selectDiscussionUninitializedIds,
} from '../workspace-discussion-selectors';

/** Each explicit refresh is bounded, even after a long outage or a broken cursor. */
const MAX_CATCH_UP_PAGES = 10;
type ReadAction =
  ReturnType<typeof discussionRequested> | ReturnType<typeof discussionOlderRequested>;
type SendAction =
  ReturnType<typeof discussionSendRequested> | ReturnType<typeof discussionRetryRequested>;

function* isCurrent(target: DiscussionTarget): SagaGenerator<boolean> {
  const current = yield* select(selectDiscussionTarget.select, target.workspaceId);
  return current?.context === target.context && current.epoch === target.epoch;
}

function* loadDiscussion(action: ReadAction): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const target = yield* select(selectDiscussionTarget.select, workspaceId);
  if (!target) return;
  const row = yield* select(selectWorkspaceDiscussion.select, workspaceId);
  const older = action.type === discussionOlderRequested.type;
  if (older && (!row.hasMore || row.catchUp)) return;
  const direction = older ? 'older' : row.syncedSequence === null ? 'initial' : 'newer';
  let afterSequence = older ? undefined : (row.syncedSequence ?? undefined);
  const beforeSequence = older ? (row.beforeSequence ?? undefined) : undefined;
  const requestId = uuid();
  yield* put(discussionLoadStarted(target, requestId, older));
  try {
    for (let page = 0; page < MAX_CATCH_UP_PAGES; page++) {
      if (!(yield* isCurrent(target))) return;
      const result = yield* call(workspaceDiscussionClient.list, {
        workspaceId,
        ...(beforeSequence !== undefined ? { beforeSequence } : {}),
        ...(afterSequence !== undefined ? { afterSequence } : {}),
        limit: DISCUSSION_PAGE_SIZE,
      });
      if (!(yield* isCurrent(target))) return;
      yield* put(discussionPageReceived(target, requestId, result, direction));
      if (direction !== 'newer' || !result.hasMore) {
        yield* put(discussionLoadFinished(target, requestId, null));
        return;
      }
      // The client rejects empty/nonadvancing pages before a cursor can be committed.
      afterSequence = result.messages.at(-1)?.sequence ?? afterSequence;
    }
    // Leave the continuation cursor visible through error/retry instead of hiding a gap.
    yield* put(discussionLoadFinished(target, requestId, 'unknown'));
  } catch (error) {
    if (yield* isCurrent(target))
      yield* put(discussionLoadFinished(target, requestId, discussionError(error)));
  }
}

function* sendDiscussion(action: SendAction): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  const target = yield* select(selectDiscussionTarget.select, workspaceId);
  if (!target || !(yield* select(selectDiscussionReady.select, workspaceId))) return;
  const row = yield* select(selectWorkspaceDiscussion.select, workspaceId);
  if (row.sending) return;
  const retryId = action.type === discussionRetryRequested.type ? action.payload[1] : undefined;
  const previous = retryId
    ? getItem(row.pending, retryId)
    : getItems(row.pending).find((m) => m.body === row.draft && m.status === 'failed');
  if (retryId && !previous) return;
  const body = previous?.body ?? row.draft;
  if (!body.trim()) return;
  const pending = {
    id: previous?.id ?? uuid(),
    body,
    draftVersion: previous?.draftVersion ?? row.draftVersion,
    status: 'sending' as const,
    error: null,
  };
  yield* put(discussionSendStarted(target, pending));
  if (new TextEncoder().encode(body).length > DISCUSSION_MAX_BODY_BYTES) {
    yield* put(discussionSendFailed(target, pending.id, 'invalid'));
    return;
  }
  try {
    const { message } = yield* call(workspaceDiscussionClient.send, {
      workspaceId,
      messageId: pending.id,
      body,
    });
    if (yield* isCurrent(target)) yield* put(discussionSendSucceeded(target, pending.id, message));
  } catch (error) {
    if (yield* isCurrent(target))
      yield* put(discussionSendFailed(target, pending.id, discussionError(error)));
  }
}

function* workspacesChanged({
  payload: ids,
}: SelectorChannelPayload<string[]>): SagaGenerator<void> {
  yield* put(discussionWorkspacesChanged(ids));
  const requested = yield* select(selectDiscussionUninitializedIds.select);
  for (const id of requested) yield* put(discussionRequested(id));
}

/** Admission includes backend, principal, membership revision and acknowledged event subscription.
 * Cancelling this owner cancels every old worker before a replacement can issue requests. */
function* runDiscussion({
  payload: context,
}: SelectorChannelPayload<string | null>): SagaGenerator<void> {
  const owner = context ? yield* select(selectDiscussionOwner.select) : null;
  yield* put(discussionContextChanged(context, owner));
  if (!context) return;
  yield* put(discussionWorkspacesChanged(yield* select(selectDiscussionWorkspaceIds.select)));
  const tasks: Task[] = [];
  try {
    tasks.push(yield* takeEveryFromSelector(selectDiscussionWorkspaceIds, workspacesChanged));
    tasks.push(
      yield* takeLeadingInContext(
        [discussionRequested, discussionOlderRequested],
        (a: ReadAction) => a.payload[0],
        readWhileWorkspaceExists,
      ),
    );
    tasks.push(
      yield* takeLeadingInContext(
        [discussionSendRequested, discussionRetryRequested],
        (a: SendAction) => a.payload[0],
        sendWhileWorkspaceExists,
      ),
    );
    const ids = yield* select(selectDiscussionRequestedIds.select);
    for (const id of ids) yield* put(discussionRequested(id));
    yield* all(tasks.map((task) => join(task)));
  } finally {
    for (const task of tasks) yield* cancel(task);
  }
}
export function* workspaceDiscussionSaga(): SagaGenerator<void> {
  yield* takeLatestFromSelector(selectDiscussionContext, runDiscussion);
}

function workspaceRemoved(workspaceId: string) {
  return (action: { type: string; payload?: unknown }) => {
    if (action.type !== discussionWorkspacesChanged.type || !Array.isArray(action.payload))
      return false;
    const ids: unknown = action.payload[0];
    return Array.isArray(ids) && !ids.includes(workspaceId);
  };
}
function* readWhileWorkspaceExists(action: ReadAction): SagaGenerator<void> {
  yield* race({
    done: call(loadDiscussion, action),
    removed: take(workspaceRemoved(action.payload[0])),
  });
}
function* sendWhileWorkspaceExists(action: SendAction): SagaGenerator<void> {
  yield* race({
    done: call(sendDiscussion, action),
    removed: take(workspaceRemoved(action.payload[0])),
  });
}
