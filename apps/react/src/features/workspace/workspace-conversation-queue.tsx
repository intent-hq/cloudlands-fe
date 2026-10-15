import { useEffect } from 'react';
import { store } from '@/store';
import { ListView, ListRow } from '@/components/patterns/collection';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/patterns/screen';
import { QueuedMessageActions } from '@/features/chat/components/queued-message-actions';
import { captureQueueRemovalRequest } from '@/features/agent/queue-runtime';
import {
  selectAgentQueueEntry,
  selectAgentQueueMessages,
  selectQueuedMessageMutations,
} from '@/store/agent-queue/agent-queue-selectors';
import { selectAgentMessages } from '@/store/agent-session/agent-session-selectors';
import {
  selectPrincipalSnapshot,
  selectCanAdministerHost,
  selectPrincipalConnectionContext,
} from '@/store/principal/principal-selectors';
import { selectWorkspaceById } from '@/store/workspace/workspace-selectors';
import { selectChatDraftOwnerView } from '@/store/chat-drafts/chat-drafts-selectors';
import { queuedMessagePermissions } from '$lib/utils/queued-message-permissions';
import { omitDrainedQueuedMessages } from '$lib/utils/queued-message-visibility';
import {
  queuedMessageMutationRequested,
  queuedMessageMutationsReleased,
  refreshAgentQueueRequested,
} from '../../../../../src/store/renderer/slices/agent-queue/agent-queue-slice';
import { m } from '$shared/paraglide/messages.js';

/** The daemon queue is a canonical mirror; this host never stores or drains messages. */
export function WorkspaceConversationQueue({
  agentId,
  workspaceId,
  ownerId,
  hideEmpty = false,
}: {
  agentId: string;
  workspaceId: string;
  ownerId: string;
  hideEmpty?: boolean;
}) {
  const entry = selectAgentQueueEntry(agentId, workspaceId).value;
  const queue = selectAgentQueueMessages(agentId, workspaceId).value;
  const messages = selectAgentMessages(agentId).value;
  const authority = selectPrincipalConnectionContext().value;
  const principal = selectPrincipalSnapshot().value;
  const hostOwner = selectCanAdministerHost().value;
  const workspace = selectWorkspaceById(workspaceId).value;
  const mutations = selectQueuedMessageMutations(agentId, workspaceId).value;
  const draft = selectChatDraftOwnerView(ownerId).value;
  const visible = omitDrainedQueuedMessages(queue, messages);
  const outcomes = mutations.filter(
    (item) =>
      item.removalScope?.principalId === principal?.principal.id &&
      item.removalBackendId === store.state.connections.windowBackendId,
  );
  const restored = draft?.restore?.status === 'restored';
  useEffect(() => {
    if (restored) store.dispatch(refreshAgentQueueRequested(agentId, workspaceId, ownerId));
  }, [restored, draft?.restore?.requestId, agentId, workspaceId, ownerId]);
  useEffect(
    () => () => {
      store.dispatch(queuedMessageMutationsReleased(ownerId));
    },
    [ownerId],
  );
  function refresh() {
    store.dispatch(refreshAgentQueueRequested(agentId, workspaceId, ownerId));
  }
  function remove(messageId: string) {
    if (!draft?.restore) return;
    const request = captureQueueRemovalRequest(agentId, workspaceId, ownerId, messageId, {
      lifetime: draft.restore.requestId,
      authority,
    });
    if (request) store.dispatch(queuedMessageMutationRequested(request));
  }
  if (
    hideEmpty &&
    visible.length === 0 &&
    !entry?.error &&
    !outcomes.some((item) => item.status !== 'cancelled')
  )
    return null;
  return (
    <section
      className="grid min-w-0 gap-2"
      data-testid="conversation-queue"
      aria-label={m.chat_connectedQueue_heading_label()}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="type-caption font-medium">{m.chat_connectedQueue_heading_label()}</h3>
        <Button
          size="sm"
          variant="plain"
          disabled={!restored || entry?.isHydrating}
          onClick={refresh}
        >
          {m.workspace_commitsTimeline_refresh_label()}
        </Button>
      </div>
      {entry?.isHydrating && (
        <LoadingState density="compact" count={1} label={m.ui_spinner_loading_ariaLabel()} />
      )}
      {entry?.error && (
        <ErrorState
          density="compact"
          message={entry?.error}
          onRetry={refresh}
          retryLabel={m.ui_combobox_retry_label()}
        />
      )}
      <ListView
        items={visible}
        status={!entry ? 'loading' : 'ready'}
        getKey={(item) => item.id}
        ariaLabel={m.chat_connectedQueue_heading_label()}
        virtualize={false}
        animateRows={false}
        empty={
          entry?.isHydrating || entry?.error ? (
            <></>
          ) : (
            <p className="type-caption text-muted-foreground">
              {m.chat_connectedQueue_empty_description()}
            </p>
          )
        }
        row={({ item }) => {
          const pending = outcomes.some(
            (outcome) =>
              outcome.messageId === item.id &&
              (outcome.status === 'pending' || outcome.removalOutcome === 'unknown'),
          );
          const permissions = queuedMessagePermissions(
            item,
            principal?.principal.id,
            workspace?.ownerPrincipalId,
            hostOwner,
          );
          return (
            <ListRow
              data-queued-id={item.id}
              title={<span className="block whitespace-pre-wrap break-words">{item.content}</span>}
              description={
                (item.submissionIds?.length ?? 0) > 1
                  ? m.chat_connectedQueue_merged_description()
                  : undefined
              }
              trailing={
                <QueuedMessageActions
                  permissions={{ edit: false, sendNow: false, remove: permissions.remove }}
                  editDisabled
                  sendDisabled
                  sending={false}
                  removeDisabled={!restored || pending}
                  onedit={() => {}}
                  onremove={() => remove(item.id)}
                />
              }
            />
          );
        }}
      />
      {outcomes
        .filter((item) => item.status !== 'cancelled')
        .map((item) => (
          <output
            key={item.requestId}
            className="type-caption text-muted-foreground"
            data-removal-outcome={item.removalOutcome ?? item.status}
          >
            {item.status === 'pending'
              ? m.chat_connectedQueue_removing_description()
              : item.removalOutcome === 'no-longer-queued'
                ? m.chat_connectedQueue_absent_description()
                : item.removalOutcome === 'unknown'
                  ? m.chat_connectedQueue_unknown_description()
                  : (item.error ?? m.agent_streamLifecycle_sendFailed_error())}
          </output>
        ))}
    </section>
  );
}
