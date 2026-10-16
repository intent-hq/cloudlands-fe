import { selectPanelLayoutWorkspaces } from '../../panel-layout/panel-layout-selectors';
import { discussionTitle } from '$features/discussions/discussion-title';
import { promoteDiscussionTab } from '../../panel-layout/panel-layout-slice';
import type { PanelTab } from '../../panel-layout/panel-layout-types';
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
  takeEvery,
  fork,
  type SagaGenerator,
} from 'typed-redux-saga';
import type { Task } from 'redux-saga';
import { workspaceDiscussionClient, discussionError } from '$lib/client/live/workspace-discussion';
import {
  DEFAULT_DISCUSSION_ID,
  NEW_DISCUSSION_ID,
  discussionKey,
  DISCUSSION_MAX_BODY_BYTES,
  DISCUSSION_PAGE_SIZE,
  type DiscussionConversation,
} from '$shared/types/workspace-discussion';
import { takeLeadingInContext, takeLatestInContext } from '../../../utils/context-saga-effects';
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
  discussionCapabilityReceived,
  discussionDirectoryRequested,
  discussionDirectoryStarted,
  discussionDirectoryReceived,
  discussionDirectoryFailed,
  discussionRecipientsRequested,
  discussionRecipientsStarted,
  discussionRecipientsReceived,
  discussionRecipientsFailed,
  discussionMembershipInvalidated,
} from '../workspace-discussion-slice';
import {
  selectDiscussionContext,
  selectDiscussionCapability,
  selectDiscussionDirectoryRequestedIds,
  selectDiscussionRecipientState,
  selectDiscussionDirectory,
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
  const current = yield* select(
    selectDiscussionTarget.select,
    target.workspaceId,
    target.conversationId,
  );
  return current?.context === target.context && current.epoch === target.epoch;
}

function* loadDiscussion(action: ReadAction): SagaGenerator<void> {
  const [workspaceId, conversationId = DEFAULT_DISCUSSION_ID] = action.payload;
  const target = yield* select(selectDiscussionTarget.select, workspaceId, conversationId);
  if (!target) return;
  const row = yield* select(selectWorkspaceDiscussion.select, workspaceId, conversationId);
  const older = action.type === discussionOlderRequested.type;
  if (older && (!row.hasMore || row.catchUp)) return;
  const direction = older ? 'older' : row.syncedSequence === null ? 'initial' : 'newer';
  let afterSequence = older ? undefined : (row.syncedSequence ?? undefined);
  const beforeSequence = older ? (row.beforeSequence ?? undefined) : undefined;
  const requestId = uuid();
  yield* put(discussionLoadStarted(target, requestId, older));
  try {
    const supported =
      conversationId === DEFAULT_DISCUSSION_ID ? false : yield* ensureConversations();
    if (conversationId === NEW_DISCUSSION_ID) {
      yield* put(discussionLoadFinished(target, requestId, supported ? null : 'unsupported'));
      if (supported) yield* put(discussionRecipientsRequested(workspaceId));
      return;
    }
    for (let page = 0; page < MAX_CATCH_UP_PAGES; page++) {
      if (!(yield* isCurrent(target))) return;
      const result = yield* call(
        workspaceDiscussionClient.list,
        {
          workspaceId,
          ...(conversationId !== DEFAULT_DISCUSSION_ID ? { conversationId } : {}),
          ...(beforeSequence !== undefined ? { beforeSequence } : {}),
          ...(afterSequence !== undefined ? { afterSequence } : {}),
          limit: DISCUSSION_PAGE_SIZE,
        },
        supported,
      );
      if (!(yield* isCurrent(target))) return;
      if (result.conversation && conversationId !== DEFAULT_DISCUSSION_ID) {
        const owner = yield* select(selectDiscussionOwner.select);
        const principalId: string | undefined = owner ? JSON.parse(owner)[1] : undefined;
        if (!result.conversation.participants.some((p) => p.principalId === principalId))
          throw new Error('Invalid discussion participants');
      }
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
  const conversationId =
    (action.type === discussionRetryRequested.type ? action.payload[2] : action.payload[1]) ??
    DEFAULT_DISCUSSION_ID;
  const target = yield* select(selectDiscussionTarget.select, workspaceId, conversationId);
  if (!target || !(yield* select(selectDiscussionReady.select, workspaceId, conversationId)))
    return;
  const row = yield* select(selectWorkspaceDiscussion.select, workspaceId, conversationId);
  if (row.sending) return;
  const retryId = action.type === discussionRetryRequested.type ? action.payload[1] : undefined;
  const previous = retryId
    ? getItem(row.pending, retryId)
    : getItems(row.pending).find((m) => m.body === row.draft && m.status === 'failed');
  if (retryId && !previous) return;
  // An uncertain create must retry its original key/body/recipients before any new send.
  if (conversationId === NEW_DISCUSSION_ID && getItems(row.pending).length && !previous) return;
  if (conversationId === NEW_DISCUSSION_ID && !row.recipientPrincipalIds.length) return;
  const body = previous?.body ?? row.draft;
  if (!body.trim()) return;
  const pending = {
    id: previous?.id ?? uuid(),
    body,
    draftVersion: previous?.draftVersion ?? row.draftVersion,
    status: 'sending' as const,
    error: null,
    ...(conversationId === NEW_DISCUSSION_ID
      ? { recipientPrincipalIds: previous?.recipientPrincipalIds ?? row.recipientPrincipalIds }
      : {}),
  };
  yield* put(discussionSendStarted(target, pending));
  if (new TextEncoder().encode(body).length > DISCUSSION_MAX_BODY_BYTES) {
    yield* put(discussionSendFailed(target, pending.id, 'invalid'));
    return;
  }
  try {
    const supported = (yield* select(selectDiscussionCapability.select)) === true;
    const { message, conversation } = yield* call(
      workspaceDiscussionClient.send,
      {
        workspaceId,
        messageId: pending.id,
        body,
        ...(conversationId === NEW_DISCUSSION_ID
          ? { recipientPrincipalIds: pending.recipientPrincipalIds }
          : conversationId !== DEFAULT_DISCUSSION_ID
            ? { conversationId }
            : {}),
      },
      supported,
    );
    const owner = yield* select(selectDiscussionOwner.select);
    if (!owner || message.author.principalId !== JSON.parse(owner)[1])
      throw new Error('Invalid discussion author');
    if (yield* isCurrent(target)) {
      yield* put(discussionSendSucceeded(target, pending.id, message, conversation));
      if (conversationId === NEW_DISCUSSION_ID && conversation)
        yield* promoteCreatedConversation(workspaceId, conversation, message.author.principalId);
    }
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
  for (const key of requested) {
    const [ws, id] = JSON.parse(key);
    yield* put(discussionRequested(ws, id));
  }
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
        (a: ReadAction) => discussionKey(a.payload[0], a.payload[1]),
        readWhileWorkspaceExists,
      ),
    );
    tasks.push(
      yield* takeLeadingInContext(
        [discussionSendRequested, discussionRetryRequested],
        (a: SendAction) =>
          discussionKey(
            a.payload[0],
            a.type === discussionRetryRequested.type ? a.payload[2] : a.payload[1],
          ),
        sendWhileWorkspaceExists,
      ),
    );
    tasks.push(
      yield* takeLatestInContext(discussionDirectoryRequested, (a) => a.payload[0], loadDirectory),
    );
    tasks.push(
      yield* takeLatestInContext(
        discussionRecipientsRequested,
        (a) => a.payload[0],
        loadRecipients,
      ),
    );
    tasks.push(yield* takeEvery(discussionMembershipInvalidated, refreshMembership));
    const directories = yield* select(selectDiscussionDirectoryRequestedIds.select);
    for (const ws of directories) yield* put(discussionDirectoryRequested(ws));
    const ids = yield* select(selectDiscussionRequestedIds.select);
    for (const key of ids) {
      const [ws, id] = JSON.parse(key);
      yield* put(discussionRequested(ws, id));
    }
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
    if (action.type === discussionMembershipInvalidated.type && Array.isArray(action.payload))
      return action.payload[0] === workspaceId;
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

function* ensureConversations(): SagaGenerator<boolean> {
  const known = yield* select(selectDiscussionCapability.select);
  if (known !== null) return known;
  const context = yield* select(selectDiscussionContext.select);
  if (!context) return false;
  const supported = yield* call(workspaceDiscussionClient.supportsConversations);
  yield* put(discussionCapabilityReceived(context, supported));
  return supported;
}
function* loadDirectory({
  payload: [workspaceId, older = false],
}: ReturnType<typeof discussionDirectoryRequested>): SagaGenerator<void> {
  const context = yield* select(selectDiscussionContext.select);
  const ids = yield* select(selectDiscussionWorkspaceIds.select);
  if (!context || !ids.includes(workspaceId)) return;
  const row = yield* select(selectDiscussionDirectory.select, workspaceId);
  if (older && !row?.hasMore) return;
  const requestId = uuid();
  yield* put(discussionDirectoryStarted(context, workspaceId, requestId));
  try {
    const supported = yield* ensureConversations();
    const result = yield* call(
      workspaceDiscussionClient.conversations,
      { workspaceId, ...(older ? { beforeId: row?.beforeId } : {}), limit: DISCUSSION_PAGE_SIZE },
      supported,
    );
    const owner = yield* select(selectDiscussionOwner.select);
    const principalId: string | undefined = owner ? JSON.parse(owner)[1] : undefined;
    if (
      result.conversations.some(
        (c) =>
          c.id !== DEFAULT_DISCUSSION_ID &&
          !c.participants.some((p) => p.principalId === principalId),
      )
    )
      throw new Error('Invalid discussion participants');
    yield* put(discussionDirectoryReceived(context, workspaceId, requestId, result));
  } catch (error) {
    yield* put(discussionDirectoryFailed(context, workspaceId, requestId, discussionError(error)));
  }
}
function* loadRecipients({
  payload: [workspaceId, query = '', older = false],
}: ReturnType<typeof discussionRecipientsRequested>): SagaGenerator<void> {
  const context = yield* select(selectDiscussionContext.select);
  const ids = yield* select(selectDiscussionWorkspaceIds.select);
  if (!context || !ids.includes(workspaceId)) return;
  const row = yield* select(selectDiscussionRecipientState.select, workspaceId);
  if (older && (!row?.hasMore || row.query !== query)) return;
  const requestId = uuid();
  yield* put(discussionRecipientsStarted(context, workspaceId, requestId, query));
  try {
    const supported = yield* ensureConversations();
    const result = yield* call(
      workspaceDiscussionClient.recipients,
      {
        workspaceId,
        query,
        ...(older ? { afterPrincipalId: row?.afterPrincipalId } : {}),
        limit: DISCUSSION_PAGE_SIZE,
      },
      supported,
    );
    yield* put(discussionRecipientsReceived(context, workspaceId, requestId, result, older));
  } catch (error) {
    yield* put(discussionRecipientsFailed(context, workspaceId, requestId, discussionError(error)));
  }
}
function* refreshMembership({
  payload: [workspaceId],
}: ReturnType<typeof discussionMembershipInvalidated>): SagaGenerator<void> {
  // Forked one tick of saga scheduling after the cancellation action has reached read workers.
  yield* fork(function* () {
    const ids = yield* select(selectDiscussionRequestedIds.select);
    for (const key of ids) {
      const [ws, id] = JSON.parse(key);
      if (ws === workspaceId) yield* put(discussionRequested(ws, id));
    }
    yield* put(discussionDirectoryRequested(workspaceId));
  });
}

/** The send may finish after its pane closes; promote every restorable copy here. */
function* promoteCreatedConversation(
  workspaceId: string,
  conversation: DiscussionConversation,
  principalId: string,
): SagaGenerator<void> {
  const layouts = yield* select(selectPanelLayoutWorkspaces.select);
  const title = discussionTitle(conversation, principalId);
  for (const [layoutId, layout] of Object.entries(layouts)) {
    const tabs: PanelTab[] = [
      ...Object.values(layout.panels).flatMap((panel) => panel.tabs),
      ...getItems(layout.hiddenTabs),
      ...layout.recentlyClosed.map((entry) => entry.tab),
      ...(layout.recentlyClosedColumns
        ? getItems(layout.recentlyClosedColumns).flatMap((entry) => entry.panel.tabs)
        : []),
      ...layout.layoutHistory.flatMap((snapshot) =>
        Object.values(snapshot.panels).flatMap((panel) => panel.tabs),
      ),
    ];
    const ids = new Set(
      tabs
        .filter(
          (tab) =>
            tab.type === 'discussion' &&
            tab.data?.conversationId === NEW_DISCUSSION_ID &&
            (tab.workspaceId ?? layoutId) === workspaceId,
        )
        .map((tab) => tab.id),
    );
    for (const id of ids) yield* put(promoteDiscussionTab(layoutId, id, conversation.id, title));
  }
}
