import { discussionAgentIds } from '$features/discussions/discussion-agent-mentions';
import { readSetting, invalidateSettingsReadCache } from '$lib/client/live/live-settings-client';
import { selectCanAdministerHost } from '../../principal/principal-selectors';
import { selectWorkspaceById } from '../../workspace/workspace-selectors';
import { settingsChanged } from '../../settings-events/settings-events-slice';
import {
  openShareDialog,
  sharePrerequisitesSettled,
} from '../../workspace-share/workspace-share-slice';
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
  takeLatest,
  fork,
  type SagaGenerator,
} from 'typed-redux-saga';
import type { Task } from 'redux-saga';
import { workspaceDiscussionClient, discussionError } from '$lib/client/live/workspace-discussion';
import {
  DEFAULT_DISCUSSION_ID,
  NEW_DISCUSSION_ID,
  discussionKey,
  discussionAgentControlKey,
  DISCUSSION_MAX_BODY_BYTES,
  DISCUSSION_PAGE_SIZE,
  type DiscussionConversation,
} from '$shared/types/workspace-discussion';
import { takeLeadingInContext, takeLatestInContext } from '../../../utils/context-saga-effects';
import {
  discussionMessageActionsReceived,
  discussionReactionsCapabilityReceived,
  discussionAgentCapabilityReceived,
  discussionAgentActivityCapabilityReceived,
  discussionPrincipalMentionsCapabilityReceived,
  discussionAgentActivityReceived,
  discussionAgentControlRequested,
  discussionAgentControlStarted,
  discussionAgentControlFinished,
  discussionReactionRequested,
  discussionReactionStarted,
  discussionReactionFinished,
  discussionReactionReceived,
  discussionMetadataProgress,
  discussionSharingReceived,
  discussionSharingRefreshRequested,
  discussionEnableSharingRequested,
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
  selectDiscussionMessageActionsSupported,
  selectDiscussionReactionsSupported,
  selectDiscussionAgentMessagingSupported,
  selectDiscussionAgentActivitySupported,
  selectDiscussionPrincipalMentionsSupported,
  selectDiscussionCanControlAgent,
  selectDiscussionCanInteract,
  selectDiscussionCanSend,
  selectDiscussionCanEnableSharing,
  selectDiscussionAuthor,
  selectDiscussionContext,
  selectDiscussionCapability,
  selectDiscussionDirectoryRequestedIds,
  selectDiscussionRecipientState,
  selectDiscussionDirectory,
  selectDiscussionOwner,
  selectDiscussionWorkspaceIds,
  selectDiscussionTarget,
  selectWorkspaceDiscussion,
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
    const actionsSupported = yield* ensureMessageActions();
    const reactionsSupported = yield* ensureReactions();
    const agentsSupported = yield* ensureAgentMessaging();
    const activitySupported = yield* ensureAgentActivity();
    const principalMentionsSupported = yield* ensurePrincipalMentions();
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
        actionsSupported,
        agentsSupported,
        activitySupported,
        reactionsSupported,
        principalMentionsSupported,
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
        if (
          direction === 'newer' &&
          (actionsSupported ||
            activitySupported ||
            reactionsSupported ||
            principalMentionsSupported)
        )
          yield* refreshMessageMetadata(
            target,
            requestId,
            supported,
            actionsSupported,
            agentsSupported,
            activitySupported,
            reactionsSupported,
            principalMentionsSupported,
          );
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
  if (!target || !(yield* select(selectDiscussionCanSend.select, workspaceId, conversationId)))
    return;
  const row = yield* select(selectWorkspaceDiscussion.select, workspaceId, conversationId);
  if (row.sending) return;
  const retryId = action.type === discussionRetryRequested.type ? action.payload[1] : undefined;
  const previous = retryId
    ? getItem(row.pending, retryId)
    : getItems(row.pending).find(
        (m) =>
          m.body === row.draft &&
          JSON.stringify([...(m.recipientAgentIds ?? [])].sort()) ===
            JSON.stringify(discussionAgentIds(row.agentMentions)) &&
          JSON.stringify(m.principalMentions ?? []) === JSON.stringify(row.principalMentions) &&
          (m.replyToMessageId ?? null) === row.replyToMessageId &&
          m.status === 'failed',
      );
  if (retryId && !previous) return;
  // An uncertain create must retry its original key/body/recipients before any new send.
  if (conversationId === NEW_DISCUSSION_ID && getItems(row.pending).length && !previous) return;
  if (conversationId === NEW_DISCUSSION_ID && !row.recipientPrincipalIds.length) return;
  const body = previous?.body ?? row.draft;
  if (!body.trim()) return;
  const author = yield* select(selectDiscussionAuthor.select);
  if (!author) return;
  const replyId = previous ? previous.replyToMessageId : (row.replyToMessageId ?? undefined);
  const reply = replyId ? getItem(row.messages, replyId) : undefined;
  const activitySupported = yield* ensureAgentActivity();
  const principalMentionsSupported = yield* ensurePrincipalMentions();
  if (!(yield* isCurrent(target))) return;
  const pending = {
    id: previous?.id ?? uuid(),
    body,
    recipientAgentIds: previous
      ? (previous.recipientAgentIds ?? [])
      : discussionAgentIds(row.agentMentions),
    agentMentions: previous ? (previous.agentMentions ?? []) : row.agentMentions,
    principalMentions: previous ? (previous.principalMentions ?? []) : row.principalMentions,
    sentPrincipalMentions: previous
      ? previous.sentPrincipalMentions
      : principalMentionsSupported || row.principalMentions.length
        ? row.principalMentions
        : undefined,
    sentAgentMentions: previous
      ? previous.sentAgentMentions
      : activitySupported
        ? row.agentMentions
        : undefined,
    author: previous?.author ?? author,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    replyVersion: previous?.replyVersion ?? row.replyVersion,
    ...(replyId
      ? {
          replyToMessageId: replyId,
          replyTo:
            previous?.replyTo ??
            (reply ? { id: reply.id, author: reply.author, body: reply.body } : null),
        }
      : {}),
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
    const actionsSupported = yield* ensureMessageActions();
    const reactionsSupported = yield* ensureReactions();
    const agentsSupported = yield* ensureAgentMessaging();
    const supported = (yield* select(selectDiscussionCapability.select)) === true;
    const { message, conversation } = yield* call(
      workspaceDiscussionClient.send,
      {
        workspaceId,
        messageId: pending.id,
        body,
        ...(pending.sentPrincipalMentions !== undefined
          ? { principalMentions: pending.sentPrincipalMentions }
          : {}),
        ...(pending.sentAgentMentions !== undefined
          ? { agentMentions: pending.sentAgentMentions }
          : {}),
        ...(pending.recipientAgentIds.length
          ? { recipientAgentIds: pending.recipientAgentIds }
          : {}),
        ...(pending.replyToMessageId ? { replyToMessageId: pending.replyToMessageId } : {}),
        ...(conversationId === NEW_DISCUSSION_ID
          ? { recipientPrincipalIds: pending.recipientPrincipalIds }
          : conversationId !== DEFAULT_DISCUSSION_ID
            ? { conversationId }
            : {}),
      },
      supported,
      actionsSupported,
      agentsSupported,
      activitySupported,
      reactionsSupported,
      principalMentionsSupported,
    );
    const owner = yield* select(selectDiscussionOwner.select);
    if (
      !owner ||
      message.author.agentId !== undefined ||
      message.author.principalId !== JSON.parse(owner)[1]
    )
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
    tasks.push(yield* fork(ensurePrincipalMentions));
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
    tasks.push(
      yield* takeLeadingInContext(
        discussionReactionRequested,
        (a) => JSON.stringify(a.payload),
        reactWhileWorkspaceExists,
      ),
    );
    tasks.push(
      yield* takeLeadingInContext(
        discussionAgentControlRequested,
        (a) =>
          JSON.stringify([
            a.payload[0],
            a.payload[5] ?? DEFAULT_DISCUSSION_ID,
            a.payload[1],
            a.payload[2],
          ]),
        controlWhileWorkspaceExists,
      ),
    );
    tasks.push(yield* takeEvery(discussionMembershipInvalidated, refreshMembership));
    tasks.push(yield* takeLatest(discussionSharingRefreshRequested, refreshSharing));
    tasks.push(
      yield* takeEvery([settingsChanged, sharePrerequisitesSettled], requestSharingRefresh),
    );
    tasks.push(yield* takeEvery(discussionEnableSharingRequested, openSharing));
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
  if (action.type === discussionRequested.type) yield* put(discussionSharingRefreshRequested());
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

const SHARING_PATHS = ['server.wsApi.enabled', 'server.tunnel.enabled'] as const;
function* requestSharingRefresh(
  action: ReturnType<typeof settingsChanged | typeof sharePrerequisitesSettled>,
): SagaGenerator<void> {
  if (
    action.type === settingsChanged.type &&
    !(action as ReturnType<typeof settingsChanged>).payload[0].some(({ path }) =>
      SHARING_PATHS.some((p) => p === path),
    )
  )
    return;
  yield* put(discussionSharingRefreshRequested());
}
function* refreshSharing(): SagaGenerator<void> {
  if (!(yield* select(selectCanAdministerHost.select))) return;
  const context = yield* select(selectDiscussionContext.select);
  if (!context) return;
  try {
    invalidateSettingsReadCache(SHARING_PATHS);
    const values = yield* all(SHARING_PATHS.map((path) => call(readSetting, path)));
    const enabled = values.every((v) => typeof v?.value === 'boolean')
      ? values.every((v) => v?.value === true)
      : null;
    yield* put(discussionSharingReceived(context, enabled));
  } catch {
    yield* put(discussionSharingReceived(context, null));
  }
}
function* openSharing({
  payload: [workspaceId],
}: ReturnType<typeof discussionEnableSharingRequested>): SagaGenerator<void> {
  if (!(yield* select(selectDiscussionCanEnableSharing.select, workspaceId))) return;
  const workspace = yield* select(selectWorkspaceById.select, workspaceId);
  if (workspace) yield* put(openShareDialog({ workspaceId, workspaceTitle: workspace.title }));
}

function* ensureAgentMessaging(): SagaGenerator<boolean> {
  const known = yield* select(selectDiscussionAgentMessagingSupported.select);
  if (known !== null) return known;
  const context = yield* select(selectDiscussionContext.select);
  if (!context) return false;
  const supported = yield* call(workspaceDiscussionClient.supportsAgentMessaging);
  yield* put(discussionAgentCapabilityReceived(context, supported));
  return supported;
}
function* ensurePrincipalMentions(): SagaGenerator<boolean> {
  const known = yield* select(selectDiscussionPrincipalMentionsSupported.select);
  if (known !== null) return known;
  const context = yield* select(selectDiscussionContext.select);
  if (!context) return false;
  const supported = yield* call(workspaceDiscussionClient.supportsPrincipalMentions);
  if (supported) yield* ensureConversations();
  yield* put(discussionPrincipalMentionsCapabilityReceived(context, supported));
  return supported;
}

function* ensureReactions(): SagaGenerator<boolean> {
  const known = yield* select(selectDiscussionReactionsSupported.select);
  if (known !== null) return known;
  const context = yield* select(selectDiscussionContext.select);
  if (!context) return false;
  const supported = yield* call(workspaceDiscussionClient.supportsReactions);
  yield* put(discussionReactionsCapabilityReceived(context, supported));
  return supported;
}
function* ensureMessageActions(): SagaGenerator<boolean> {
  const known = yield* select(selectDiscussionMessageActionsSupported.select);
  if (known !== null) return known;
  const context = yield* select(selectDiscussionContext.select);
  if (!context) return false;
  const supported = yield* call(workspaceDiscussionClient.supportsMessageActions);
  yield* put(discussionMessageActionsReceived(context, supported));
  return supported;
}
function* reactToMessage({
  payload: [workspaceId, messageId, reaction, conversationId = DEFAULT_DISCUSSION_ID],
}: ReturnType<typeof discussionReactionRequested>): SagaGenerator<void> {
  const target = yield* select(selectDiscussionTarget.select, workspaceId, conversationId);
  if (!target || !(yield* select(selectDiscussionCanInteract.select, workspaceId, conversationId)))
    return;
  const row = yield* select(selectWorkspaceDiscussion.select, workspaceId, conversationId);
  const message = getItem(row.messages, messageId);
  if (!message) return;
  const expanded = (yield* select(selectDiscussionReactionsSupported.select)) === true;
  if (!expanded && reaction !== '👍' && reaction !== '🙂') return;
  const key = JSON.stringify([messageId, reaction]);
  const active = !message.reactions?.find((r) => r.reaction === reaction)?.reacted;
  if (expanded && reaction === '🙂' && active) return;
  yield* put(discussionReactionStarted(target, key));
  try {
    const result = yield* call(
      workspaceDiscussionClient.react,
      {
        workspaceId,
        ...(conversationId !== DEFAULT_DISCUSSION_ID ? { conversationId } : {}),
        messageId,
        reaction,
        active,
      },
      true,
      expanded,
    );
    if (!(yield* isCurrent(target))) return;
    yield* put(discussionReactionReceived(target, result));
    yield* put(discussionReactionFinished(target, key, null));
  } catch (error) {
    if (yield* isCurrent(target))
      yield* put(discussionReactionFinished(target, key, discussionError(error)));
  }
}
function* reactWhileWorkspaceExists(
  action: ReturnType<typeof discussionReactionRequested>,
): SagaGenerator<void> {
  yield* race({
    done: call(reactToMessage, action),
    removed: take(workspaceRemoved(action.payload[0])),
  });
}
/** Re-read metadata on cached rows without advancing or rewinding the new-message cursor. */
function* refreshMessageMetadata(
  target: DiscussionTarget,
  requestId: string,
  conversationsSupported: boolean,
  actionsSupported: boolean,
  agentsSupported: boolean,
  activitySupported: boolean,
  reactionsSupported: boolean,
  principalMentionsSupported: boolean,
): SagaGenerator<void> {
  const row = yield* select(
    selectWorkspaceDiscussion.select,
    target.workspaceId,
    target.conversationId,
  );
  const messages = getItems(row.messages);
  if (!messages.length) return;
  const floor = row.metadataFloor ?? messages[0].sequence;
  const latest = messages[messages.length - 1].sequence;
  let before: number | undefined =
    row.metadataBefore ?? (latest < Number.MAX_SAFE_INTEGER ? latest + 1 : undefined);
  for (let page = 0; page < MAX_CATCH_UP_PAGES; page++) {
    if (before !== undefined && before <= floor) {
      yield* put(discussionMetadataProgress(target, requestId, [], null, null));
      return;
    }
    const result = yield* call(
      workspaceDiscussionClient.list,
      {
        workspaceId: target.workspaceId,
        ...(target.conversationId !== DEFAULT_DISCUSSION_ID
          ? { conversationId: target.conversationId }
          : {}),
        ...(before !== undefined ? { beforeSequence: before } : {}),
        limit: DISCUSSION_PAGE_SIZE,
      },
      conversationsSupported,
      actionsSupported,
      agentsSupported,
      activitySupported,
      reactionsSupported,
      principalMentionsSupported,
    );
    if (!(yield* isCurrent(target))) return;
    const next = result.messages[0]?.sequence;
    if (next === undefined && result.hasMore) throw new Error('Nonadvancing discussion metadata');
    const done = !result.hasMore || next === undefined || next <= floor;
    yield* put(
      discussionMetadataProgress(
        target,
        requestId,
        result.messages.filter((message) => message.sequence >= floor),
        done ? null : next,
        done ? null : floor,
      ),
    );
    if (done || next === undefined) return;
    before = next;
  }
  throw new Error('Discussion metadata refresh incomplete');
}

function* ensureAgentActivity(): SagaGenerator<boolean> {
  const known = yield* select(selectDiscussionAgentActivitySupported.select);
  if (known !== null) return known;
  const context = yield* select(selectDiscussionContext.select);
  if (!context) return false;
  const supported = yield* call(workspaceDiscussionClient.supportsAgentActivity);
  yield* put(discussionAgentActivityCapabilityReceived(context, supported));
  return supported;
}
function* controlAgent({
  payload: [
    workspaceId,
    messageId,
    agentId,
    attempt,
    operation,
    conversationId = DEFAULT_DISCUSSION_ID,
  ],
}: ReturnType<typeof discussionAgentControlRequested>): SagaGenerator<void> {
  const target = yield* select(selectDiscussionTarget.select, workspaceId, conversationId);
  if (
    !target ||
    !(yield* select(selectDiscussionCanControlAgent.select, workspaceId, conversationId))
  )
    return;
  const row = yield* select(selectWorkspaceDiscussion.select, workspaceId, conversationId);
  const message = getItem(row.messages, messageId);
  const activity = message?.agentActivity?.find((a) => a.agentId === agentId);
  const key = discussionAgentControlKey(messageId, agentId);
  if (
    !activity ||
    activity.attempt !== attempt ||
    getItem(row.agentControls, key) ||
    !message?.recipientAgentIds?.includes(agentId) ||
    (operation === 'stop'
      ? !['queued', 'working'].includes(activity.state)
      : !['failed', 'stopped'].includes(activity.state))
  )
    return;
  const requestId = uuid();
  yield* put(
    discussionAgentControlStarted(target, { key, messageId, agentId, requestId, attempt }),
  );
  try {
    const result = yield* call(
      workspaceDiscussionClient.controlAgent,
      operation,
      { workspaceId, messageId, agentId, attempt },
      true,
    );
    if (!(yield* isCurrent(target))) return;
    yield* put(discussionAgentActivityReceived(target, messageId, result.activity));
    yield* put(discussionAgentControlFinished(target, key, requestId, null));
  } catch (error) {
    if (yield* isCurrent(target))
      yield* put(discussionAgentControlFinished(target, key, requestId, discussionError(error)));
  }
}
function* controlWhileWorkspaceExists(
  action: ReturnType<typeof discussionAgentControlRequested>,
): SagaGenerator<void> {
  yield* race({
    done: call(controlAgent, action),
    removed: take(workspaceRemoved(action.payload[0])),
  });
}
