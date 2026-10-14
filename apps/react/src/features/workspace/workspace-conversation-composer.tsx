import { getChatDraftEntry } from '../../../../../src/store/renderer/slices/transient-ui/transient-ui-projections';
import { setChatDraft } from '../../../../../src/store/renderer/slices/transient-ui/transient-ui-slice';
import { useEffect, useId, useRef, useState } from 'react';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '@/store';
import { MessageComposer } from '@/components/ui/message-composer';
import { ErrorState, LoadingState } from '@/components/patterns/screen';
import {
  selectChatDraftOwnerView,
  selectChatDraft,
} from '@/store/chat-drafts/chat-drafts-selectors';
import { selectAgentSubmissionEntry } from '@/store/pending-submissions/pending-submissions-selectors';
import { selectAgentIsResponding } from '@/store/agent-session/agent-session-selectors';
import { selectChatAgentState } from '@/store/chat-state/chat-state-selectors';
import { selectWorkspaceParticipationContext } from '@/store/workspace/workspace-selectors';
import { selectPrincipalSnapshot } from '@/store/principal/principal-selectors';
import { chatSubmission, submissionRetry } from '@/features/agent/chat-runtime';
import {
  chatDraftOwnerOpened,
  chatDraftOwnerReleased,
  chatDraftRestoreRequested,
  chatDraftSaveScheduled,
  chatDraftSaveOutcomesAcknowledged,
  chatDraftSaveCancelled,
  chatDraftClearRequested,
} from '../../../../../src/store/renderer/slices/chat-drafts/chat-drafts-slice';
import type { ChatDraftSnapshot } from '../../../../../src/store/renderer/slices/chat-drafts/chat-drafts-types';
import { agentSessionStopChatRequested } from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { sendMessage } from '../../../../../src/store/renderer/slices/chat-state/chat-state-slice';
import { m } from '$shared/paraglide/messages.js';

/** Canonical draft and submission owners drive the public text-only composer. */
export function WorkspaceConversationComposer({
  workspaceId,
  agentId,
  transcriptReady = true,
}: {
  workspaceId: string;
  agentId: string;
  transcriptReady?: boolean;
}) {
  const ownerId = useId();
  const value = selectChatDraft(workspaceId, agentId).value;
  const [localError, setLocalError] = useState<string>();
  const appliedRestore = useRef<string | undefined>(undefined);
  const settledSubmission = useRef<string | undefined>(undefined);
  const [submitted, setSubmitted] = useState<{ id: string; text: string }>();
  const lastPersisted = useRef<ChatDraftSnapshot | null>(null);
  const saveSnapshots = useRef(new Map<string, ChatDraftSnapshot>());
  const mounted = useRef(false);
  const submitting = useRef<string | undefined>(undefined);
  const drafts = selectChatDraftOwnerView(ownerId).value;
  const entry = selectAgentSubmissionEntry(agentId, workspaceId).value;
  const responding = selectAgentIsResponding(agentId).value;
  const chat = selectChatAgentState(agentId).value;
  const participation = selectWorkspaceParticipationContext(workspaceId).value;
  const principal = selectPrincipalSnapshot().value;
  const pending =
    entry &&
    getItems(entry.submissions).some(
      (s) => s.status === 'preparing' || s.status === 'sending' || s.status === 'uncertain',
    );
  const restored = drafts?.restore?.status === 'restored';
  const hasAttachments = (drafts?.restore?.draft?.attachments.length ?? 0) > 0;
  const dispatch = store.dispatch;
  useEffect(() => {
    mounted.current = true;
    dispatch(chatDraftOwnerOpened(ownerId));
    dispatch(chatDraftRestoreRequested(ownerId, crypto.randomUUID(), workspaceId, agentId));
    return () => {
      mounted.current = false;
      dispatch(chatDraftOwnerReleased(ownerId));
    };
  }, [ownerId, workspaceId, agentId, dispatch]);
  useEffect(() => {
    const restore = drafts?.restore;
    if (!restore || restore.status !== 'restored' || appliedRestore.current === restore.requestId)
      return;
    appliedRestore.current = restore.requestId;
    lastPersisted.current = restore.draft ?? { text: '', attachments: [] };
    const local = getChatDraftEntry(store.state, workspaceId, agentId);
    if (local === undefined)
      dispatch(setChatDraft(workspaceId, agentId, lastPersisted.current.text, true));
    else if (local !== lastPersisted.current.text) {
      // Reconcile only draft persistence; reconnect never resends a chat message.
      const requestId = crypto.randomUUID();
      const snapshot = { ...lastPersisted.current, text: local };
      saveSnapshots.current.set(requestId, snapshot);
      dispatch(
        chatDraftSaveScheduled(ownerId, requestId, {
          workspaceId,
          agentId,
          ...snapshot,
          rollback: lastPersisted.current,
        }),
      );
    }
  }, [drafts?.restore, dispatch, workspaceId, agentId, ownerId]);
  useEffect(() => {
    const settled = drafts?.saves.filter((save) => save.status !== 'pending') ?? [];
    if (!settled.length) return;
    const activeIds = new Set(drafts?.saves.map((save) => save.id));
    for (const id of saveSnapshots.current.keys())
      if (!activeIds.has(id)) saveSnapshots.current.delete(id);
    for (const save of settled) {
      const snapshot = saveSnapshots.current.get(save.id);
      if (snapshot && save.status === 'saved') lastPersisted.current = snapshot;
      saveSnapshots.current.delete(save.id);
    }
    const saved = settled.filter((save) => save.status === 'saved');
    if (!saved.length) return;
    dispatch(
      chatDraftSaveOutcomesAcknowledged(
        ownerId,
        saved.map((save) => save.id),
      ),
    );
  }, [drafts?.saves, dispatch, ownerId]);
  useEffect(() => {
    if (!submitted || !entry || settledSubmission.current === submitted.id) return;
    const item = getItem(entry.submissions, submitted.id);
    const tombstone = getItem(entry.tombstones, submitted.id);
    if (tombstone?.reason === 'rejected') {
      submitting.current = undefined;
      settledSubmission.current = submitted.id;
      return;
    }
    if (item?.status !== 'accepted' && !tombstone) return;
    submitting.current = undefined;
    settledSubmission.current = submitted.id;
    if (value.trim() !== submitted.text) return;
    dispatch(chatDraftSaveCancelled(ownerId));
    dispatch(chatDraftClearRequested(workspaceId, agentId));
    saveSnapshots.current.clear();
    lastPersisted.current = { text: '', attachments: [] };
    dispatch(setChatDraft(workspaceId, agentId, '', true));
  }, [submitted, entry, value, dispatch, ownerId, workspaceId, agentId]);
  function edit(text: string) {
    dispatch(setChatDraft(workspaceId, agentId, text, true));
    setLocalError(undefined);
    dispatch(
      chatDraftSaveOutcomesAcknowledged(
        ownerId,
        drafts?.saves.filter((save) => save.status !== 'pending').map((save) => save.id) ?? [],
      ),
    );
    const requestId = crypto.randomUUID();
    const activeIds = new Set(drafts?.saves.map((save) => save.id));
    for (const id of saveSnapshots.current.keys())
      if (!activeIds.has(id)) saveSnapshots.current.delete(id);
    saveSnapshots.current.set(requestId, {
      text,
      attachments: lastPersisted.current?.attachments ?? [],
    });
    dispatch(
      chatDraftSaveScheduled(ownerId, requestId, {
        workspaceId,
        agentId,
        text,
        attachments: lastPersisted.current?.attachments ?? [],
        rollback: lastPersisted.current,
      }),
    );
  }
  function send(text: string) {
    if (
      !restored ||
      !transcriptReady ||
      submitting.current ||
      hasAttachments ||
      pending ||
      !participation ||
      principal?.capabilities.submissionCorrelation !== 1
    )
      return;
    const admitted = chatSubmission.admitChatMessage(store, agentId, { wsId: workspaceId, text });
    if (!admitted) {
      setLocalError(m.agent_streamLifecycle_sendFailed_error());
      return;
    }
    submitting.current = admitted.submission.id;
    setSubmitted({ id: admitted.submission.id, text: text.trim() });
    dispatch(
      sendMessage(agentId, {
        wsId: workspaceId,
        text,
        userAppMessageId: admitted.submission.appMessageId,
        submission: { scope: admitted.scope, id: admitted.submission.id },
      }),
    );
  }
  const error =
    localError ??
    (drafts?.restore?.status === 'failed' ? drafts.restore.error : undefined) ??
    drafts?.saves.find((save) => save.status === 'failed')?.error ??
    chat.error;
  return (
    <div data-testid="conversation-composer" className="grid min-w-0 gap-2">
      {!restored && !error && (
        <LoadingState density="compact" count={1} label={m.chat_draftGate_loading_label()} />
      )}
      {hasAttachments && (
        <ErrorState density="compact" message={m.ui_mediaUnavailable_unsupported_description()} />
      )}
      {error && (
        <ErrorState
          density="compact"
          message={error}
          retryLabel={m.ui_combobox_retry_label()}
          onRetry={() => {
            setLocalError(undefined);
            if (!restored)
              dispatch(
                chatDraftRestoreRequested(ownerId, crypto.randomUUID(), workspaceId, agentId),
              );
            else if (chat.lastAttemptedMessage?.submission)
              void submissionRetry
                .requestChatMessageRetry(agentId, workspaceId, undefined, (id) => {
                  if (!mounted.current) return;
                  submitting.current = id;
                  setSubmitted({ id, text: chat.lastAttemptedMessage?.text ?? value });
                })
                .catch((e) => setLocalError(String(e)));
            else edit(value);
          }}
        />
      )}
      <MessageComposer
        value={value}
        onValueChange={edit}
        onSend={send}
        status={responding ? 'streaming' : 'idle'}
        disabled={
          !restored ||
          !transcriptReady ||
          hasAttachments ||
          !participation ||
          principal?.capabilities.submissionCorrelation !== 1 ||
          (!!pending && !responding)
        }
        onStop={() => {
          void dispatch(agentSessionStopChatRequested(agentId)).catch((e) =>
            setLocalError(String(e)),
          );
        }}
      />
    </div>
  );
}
