import {
  extractAttachmentBlocks,
  buildWorkspaceContextString,
} from '$lib/components/chat/composer-submission';
import {
  serializeDraftAttachments,
  deserializeDraftAttachments,
} from '$lib/components/chat/chat-draft-attachments';
import { hasBlockingAttachments } from '$lib/components/chat/input/context-api';
import { setComposerContextItems } from '../../transient-ui/transient-ui-slice';
import { selectComposerContextItems } from '../../transient-ui/transient-ui-selectors';
import {
  selectCheckedPanels,
  selectCheckedSelections,
} from '../../multi-panel-context/multi-panel-context-selectors';
import { createAppMessageId } from '$shared/utils/app-message-id';
import {
  selectPendingSubmissionEntry,
  selectPendingSubmissionsState,
} from '../../pending-submissions/pending-submissions-selectors';
import {
  takeEveryFromSelector,
  takeLatestFromSelector,
  type SelectorChannelPayload,
} from '@themislib/themis/saga';
import { selectPrincipalActionContext } from '../../principal/principal-selectors';
import { call, fork, put, take, takeLatest, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import {
  createCollection,
  getItem,
  getItems,
} from '@themislib/themis/utils/collections/collection-utils';
import { store as appStore } from '$store/renderer/store';
import { appClient } from '$lib/client';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { WorkspaceStatus } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import { loadAnnotationRecipients } from '$features/annotation/annotation-submit-service';
import {
  acquireChatInterestLease,
  releaseChatInterestLease,
} from '$features/agent/utils/chat-interest-leases';
import { admitChatMessage } from '$features/agent/chat-submission';
import { requestChatMessageRetry } from '$features/agent/chat-submission-retry';
import { hydrateAgentQueue } from '$features/agent/agent-queue-read-service';
import { getPrincipalActionContext } from '../../principal/principal-context';
import { createChiefVirtualWorkspace } from '../../workspace-agents/chief-virtual-workspace';
import { selectChiefActiveAgentId } from '../../sidebar-nav/sidebar-nav-selectors';
import { selectWorkspaceParticipationContext } from '../../workspace/workspace-selectors';
import { setWorkspaceEntity } from '../../workspace/workspace-slice';
import {
  chatTrackedWorkspaceSet,
  initializeChatRequested,
  sendMessage,
} from '../../chat-state/chat-state-slice';
import {
  chatDraftOwnerOpened,
  chatDraftOwnerReleased,
  chatDraftRestoreRequested,
  chatDraftRestoreSettled,
  chatDraftSaveScheduled,
  chatDraftSaveCancelled,
  chatDraftClearRequested,
} from '../../chat-drafts/chat-drafts-slice';
import { selectChatDraftOwnerView } from '../../chat-drafts/chat-drafts-selectors';
import { selectDockConversationView } from '../dock-conversation-selectors';
import {
  openDockConversationRequested,
  closeDockConversationRequested,
  selectDockConversationAgentRequested,
  reloadDockConversationRequested,
  sendDockConversationRequested,
  retryDockConversationSendRequested,
  dockConversationContextSet,
  dockConversationLoaded,
  dockConversationFailed,
  dockConversationDraftChanged,
  dockConversationContextItemsChanged,
  dockConversationDraftRestored,
  dockConversationDraftAdmitted,
  dockConversationDraftRecovered,
  dockConversationDeliveryTracked,
  dockConversationDeliverySettled,
  dockConversationRetryArmed,
  dockConversationSendState,
} from '../dock-conversation-slice';

function current(generation: number, authority: string): boolean {
  return (
    appStore.state.dockConversation.generation === generation &&
    getPrincipalActionContext(appStore.state) === authority
  );
}
function* saveDrafts(
  ownerId: string,
  workspaceId: string,
  agentId: string,
  authority: string,
): SagaGenerator<void> {
  while (true) {
    const action = yield* take([dockConversationDraftChanged, dockConversationDraftRecovered]);
    if (action.payload[0] !== workspaceId || action.payload[1] !== agentId) continue;
    if (getPrincipalActionContext(appStore.state) !== authority) continue;
    const draft = getItem(
      appStore.state.dockConversation.drafts,
      JSON.stringify([workspaceId, agentId]),
    );
    if (!draft?.restored) continue;
    yield* put(
      chatDraftSaveScheduled(ownerId, crypto.randomUUID(), {
        workspaceId,
        agentId,
        text: draft.text,
        attachments: serializeDraftAttachments(
          selectComposerContextItems.select(appStore.state, workspaceId, agentId),
        ),
        rollback: null,
      }),
    );
  }
}
function* conversationLifetime(): SagaGenerator<void> {
  const { workspaceId, generation, agentId: requestedAgent } = appStore.state.dockConversation;
  if (!workspaceId) return;
  const authority = getPrincipalActionContext(appStore.state);
  if (!authority) {
    yield* put(dockConversationFailed(generation, m.dock_conversation_offline_description()));
    return;
  }
  const identity = JSON.stringify([
    appStore.state.connections.windowBackendId,
    appStore.state.principal.snapshot?.principal.id,
  ]);
  yield* put(dockConversationContextSet(identity, authority));
  let leasedAgent: string | null = null;
  const ownerId = `dock-conversation:${crypto.randomUUID()}`;
  try {
    const workspace =
      workspaceId === CHIEF_WORKSPACE_ID
        ? createChiefVirtualWorkspace()
        : yield* call([appClient.workspaces, appClient.workspaces.get], workspaceId);
    if (!current(generation, authority)) return;
    if (!workspace || workspace.status === WorkspaceStatus.Deleted || workspace.pendingDeleteAt)
      throw new Error('unavailable');
    yield* put(setWorkspaceEntity(workspace));
    const recipients = yield* call(loadAnnotationRecipients, workspaceId);
    if (!current(generation, authority)) return;
    const agents = recipients.flatMap((row) =>
      row.agentId ? [{ id: row.agentId, name: row.name, isMain: row.isDefault === true }] : [],
    );
    const selectedChief =
      workspaceId === CHIEF_WORKSPACE_ID ? selectChiefActiveAgentId.select(appStore.state) : null;
    const chosen = requestedAgent
      ? agents.find((row) => row.id === requestedAgent)
      : workspaceId === CHIEF_WORKSPACE_ID
        ? (agents.find((row) => row.id === selectedChief) ?? agents[0])
        : agents.find((row) => row.isMain);
    if (!chosen) {
      yield* put(
        dockConversationLoaded(
          generation,
          workspaceId,
          workspace.title || workspaceId,
          agents,
          null,
        ),
      );
      return;
    }
    const target = yield* call([appClient.agents, appClient.agents.get], chosen.id, workspaceId);
    if (!current(generation, authority)) return;
    if (
      !target ||
      target.workspaceId !== workspaceId ||
      target.retiredAt ||
      target.pendingDeleteAt ||
      target.status === 'deleted'
    )
      throw new Error('unavailable');
    leasedAgent = chosen.id;
    acquireChatInterestLease(chosen.id, ownerId);
    yield* put(chatTrackedWorkspaceSet(chosen.id, workspaceId));
    yield* put(initializeChatRequested(chosen.id, { wsId: workspaceId }));
    yield* put(
      dockConversationLoaded(
        generation,
        workspaceId,
        workspace.title || workspaceId,
        agents,
        chosen.id,
      ),
    );
    yield* fork(function* () {
      yield* call(hydrateAgentQueue, chosen.id, workspaceId);
    });
    yield* put(chatDraftOwnerOpened(ownerId));
    const requestId = crypto.randomUUID();
    yield* put(chatDraftRestoreRequested(ownerId, requestId, workspaceId, chosen.id));
    while (true) {
      const restore = selectChatDraftOwnerView.select(appStore.state, ownerId)?.restore;
      if (restore?.requestId === requestId && restore.status !== 'pending') {
        if (!current(generation, authority)) return;
        if (restore.status === 'failed') throw new Error('draft-restore-failed');
        const existing = getItem(
          appStore.state.dockConversation.drafts,
          JSON.stringify([workspaceId, chosen.id]),
        );
        // Live pair-scoped attachments and user edits win over a late restore.
        if (
          (!existing || existing.revision === 0) &&
          selectComposerContextItems.select(appStore.state, workspaceId, chosen.id).length === 0
        )
          yield* put(
            setComposerContextItems(
              workspaceId,
              chosen.id,
              deserializeDraftAttachments(restore.draft?.attachments ?? []),
            ),
          );
        yield* put(
          dockConversationDraftRestored(
            workspaceId,
            chosen.id,
            restore.draft?.text ?? '',
            !!restore.draft?.attachments.length,
          ),
        );
        break;
      }
      yield* take(chatDraftRestoreSettled);
    }
    yield* fork(saveDrafts, ownerId, workspaceId, chosen.id, authority);
    const draft = getItem(
      appStore.state.dockConversation.drafts,
      JSON.stringify([workspaceId, chosen.id]),
    );
    if (draft && draft.revision > 0)
      yield* put(
        chatDraftSaveScheduled(ownerId, crypto.randomUUID(), {
          workspaceId,
          agentId: chosen.id,
          text: draft.text,
          attachments: serializeDraftAttachments(
            selectComposerContextItems.select(appStore.state, workspaceId, chosen.id),
          ),
          rollback: null,
        }),
      );
    // Root takeLatest cancels this lifetime on selection, close, or reload.
    yield* take(closeDockConversationRequested);
  } catch {
    if (current(generation, authority))
      yield* put(dockConversationFailed(generation, m.dock_conversation_loadFailed_error()));
  } finally {
    // A keyed composer cannot finish an in-flight placement after it unmounts.
    // Keep its staged file as a retryable draft, never a permanently placing pill.
    if (leasedAgent && getPrincipalActionContext(appStore.state) === authority) {
      const items = selectComposerContextItems.select(appStore.state, workspaceId, leasedAgent);
      if (items.some((item) => item.placementStatus === 'placing')) {
        const retained = items.map((item) =>
          item.placementStatus === 'placing'
            ? { ...item, placementStatus: 'failed' as const, placementProgress: undefined }
            : item,
        );
        yield* put(setComposerContextItems(workspaceId, leasedAgent, retained));
        const draft = getItem(
          appStore.state.dockConversation.drafts,
          JSON.stringify([workspaceId, leasedAgent]),
        );
        if (draft?.restored)
          yield* put(
            chatDraftSaveScheduled(ownerId, crypto.randomUUID(), {
              workspaceId,
              agentId: leasedAgent,
              text: draft.text,
              attachments: serializeDraftAttachments(retained),
              rollback: null,
            }),
          );
      }
    }
    if (leasedAgent) releaseChatInterestLease(leasedAgent, ownerId);
    if (getPrincipalActionContext(appStore.state) !== authority)
      yield* put(chatDraftSaveCancelled(ownerId));
    yield* put(chatDraftOwnerReleased(ownerId));
  }
}
function* sendReply(
  action:
    | ReturnType<typeof sendDockConversationRequested>
    | ReturnType<typeof retryDockConversationSendRequested>,
): SagaGenerator<void> {
  const { workspaceId, agentId, generation, authority } = appStore.state.dockConversation;
  const retry = action.type === retryDockConversationSendRequested.type;
  const prompt = action.type === sendDockConversationRequested.type ? action.payload[0] : undefined;
  if (prompt && (prompt.workspaceId !== workspaceId || prompt.agentId !== agentId)) return;
  const view = selectDockConversationView.select(appStore.state);
  if (
    !workspaceId ||
    !agentId ||
    !authority ||
    !current(generation, authority) ||
    !selectWorkspaceParticipationContext.select(appStore.state, workspaceId) ||
    view.loading ||
    view.attention ||
    view.sending ||
    (retry && !view.canRetry) ||
    (!retry && view.blocked)
  )
    return;
  const draft = getItem(
    appStore.state.dockConversation.drafts,
    JSON.stringify([workspaceId, agentId]),
  );
  const pairItems = selectComposerContextItems.select(appStore.state, workspaceId, agentId);
  // Snapshot the entire prompt before target validation; no File handles cross Redux.
  const clickedItems = structuredClone(prompt?.contextItems ?? pairItems);
  const clickedDraft = draft
    ? { text: prompt?.text ?? draft.text, revision: draft.revision }
    : null;
  const blocks = extractAttachmentBlocks(clickedItems);
  if (
    !retry &&
    (!clickedDraft ||
      hasBlockingAttachments(clickedItems) ||
      (!clickedDraft.text.trim() && !blocks.imageBlocks.length && !blocks.fileBlocks.length))
  )
    return;
  const contextFingerprint = JSON.stringify(pairItems);
  const scopedContext = appStore.state.multiPanelContext.workspaceId === workspaceId;
  const checkedPanels = scopedContext ? selectCheckedPanels.select(appStore.state) : [];
  const checkedSelections = scopedContext ? selectCheckedSelections.select(appStore.state) : [];
  const clickedPayload = {
    wsId: workspaceId,
    text: clickedDraft?.text ?? '',
    contextItems: clickedItems,
    workspaceContextStr: buildWorkspaceContextString(
      clickedItems,
      checkedPanels,
      checkedSelections,
    ),
    ...(blocks.imageBlocks.length ? { imageBlocks: blocks.imageBlocks } : {}),
    ...(blocks.fileBlocks.length ? { fileBlocks: blocks.fileBlocks } : {}),
    ...(prompt?.forceSubmit ? { forceSubmit: true } : {}),
  };
  yield* put(dockConversationSendState(generation, true, null));
  try {
    const target = yield* call([appClient.agents, appClient.agents.get], agentId, workspaceId);
    if (!current(generation, authority)) return;
    if (
      !target ||
      target.workspaceId !== workspaceId ||
      target.retiredAt ||
      target.pendingDeleteAt ||
      target.status === 'deleted'
    )
      throw new Error('unavailable');
    const latestView = selectDockConversationView.select(appStore.state);
    if (latestView.attention || (retry && !latestView.canRetry)) return;
    if (retry) {
      if (draft && draft.delivery?.revision === draft.revision)
        yield* put(dockConversationRetryArmed(workspaceId, agentId, draft.revision));
      yield* call(requestChatMessageRetry, agentId, workspaceId);
      return;
    }
    // The click owns this immutable snapshot. Edits made during validation are
    // a different draft revision and must neither be sent nor cleared here.
    if (!clickedDraft) return;
    const appMessageId = createAppMessageId();
    const admitted = admitChatMessage(appStore, agentId, {
      ...clickedPayload,
      userAppMessageId: appMessageId,
    });
    if (!admitted) throw new Error('not-admitted');
    // Register draft ownership before dispatch can produce a fast acknowledgement.
    yield* put(
      dockConversationDeliveryTracked(workspaceId, agentId, {
        reference: { scope: admitted.scope, id: admitted.submission.id },
        revision: clickedDraft.revision,
        authority,
        contextFingerprint,
        recovery: { text: clickedDraft.text, contextItems: createCollection('id', clickedItems) },
        composerSubmissionId: prompt?.submissionId,
      }),
    );
    // Match main chat: local admission owns cleanup, not a later daemon acknowledgement.
    yield* clearAdmittedDraft(workspaceId, agentId);
    yield* put(
      sendMessage(agentId, {
        ...clickedPayload,
        userAppMessageId: appMessageId,
        submission: { scope: admitted.scope, id: admitted.submission.id },
      }),
    );
    yield* reconcileDeliveries();
  } catch {
    if (current(generation, authority))
      yield* put(
        dockConversationSendState(generation, false, m.dock_conversation_sendFailed_error()),
      );
    return;
  } finally {
    if (current(generation, authority) && appStore.state.dockConversation.sending)
      yield* put(dockConversationSendState(generation, false, null));
  }
}
function* trackRetryAdmissions(): SagaGenerator<void> {
  const authority = getPrincipalActionContext(appStore.state);
  if (!authority) return;
  for (const draft of getItems(appStore.state.dockConversation.drafts)) {
    const prior = draft.delivery;
    if (!prior || prior.authority !== authority || draft.retryRevision !== draft.revision) continue;
    const currentEntry = selectPendingSubmissionsState.select(appStore.state).byAgentId[
      prior.reference.scope.agentId
    ];
    if (!currentEntry || currentEntry.scope.workspaceId !== prior.reference.scope.workspaceId)
      continue;
    const entry = selectPendingSubmissionEntry.select(appStore.state, currentEntry.scope);
    if (!entry) continue;
    const candidates = getItems(entry.submissions).filter(
      (input) => input.id !== prior.reference.id && input.content === draft.text.trim(),
    );
    // Ambiguous ownership never authorizes clearing a draft.
    if (candidates.length !== 1) continue;
    yield* put(
      dockConversationDeliveryTracked(entry.scope.workspaceId, entry.scope.agentId, {
        reference: { scope: entry.scope, id: candidates[0].id },
        revision: draft.revision,
        authority,
        contextFingerprint: prior.contextFingerprint,
        recovery: prior.recovery,
        composerSubmissionId: prior.composerSubmissionId,
      }),
    );
    yield* clearAdmittedDraft(entry.scope.workspaceId, entry.scope.agentId);
  }
}
function* clearAdmittedDraft(workspaceId: string, agentId: string): SagaGenerator<void> {
  const draft = getItem(
    appStore.state.dockConversation.drafts,
    JSON.stringify([workspaceId, agentId]),
  );
  const delivery = draft?.delivery;
  if (!draft || !delivery || delivery.authority !== getPrincipalActionContext(appStore.state))
    return;
  if (
    draft.revision !== delivery.revision ||
    (delivery.contextFingerprint !== undefined &&
      delivery.contextFingerprint !==
        JSON.stringify(selectComposerContextItems.select(appStore.state, workspaceId, agentId)))
  )
    return;
  yield* put(dockConversationDraftAdmitted(workspaceId, agentId, delivery.revision));
  yield* put(setComposerContextItems(workspaceId, agentId, []));
  yield* put(chatDraftClearRequested(workspaceId, agentId));
}
function* reconcileDeliveries(): SagaGenerator<void> {
  for (const draft of getItems(appStore.state.dockConversation.drafts)) {
    const delivery = draft.delivery;
    if (!delivery || delivery.authority !== getPrincipalActionContext(appStore.state)) continue;
    const { scope, id } = delivery.reference;
    const entry = selectPendingSubmissionEntry.select(appStore.state, scope);
    if (!entry) continue;
    const tombstone = getItem(entry.tombstones, id);
    const accepted =
      getItem(entry.submissions, id)?.status === 'accepted' ||
      getItem(entry.operations, id)?.observed === true ||
      (!!tombstone && tombstone.reason !== 'rejected');
    if (accepted || tombstone?.reason === 'rejected')
      yield* put(dockConversationDeliverySettled(scope.workspaceId, scope.agentId, id));
    // Late delivery evidence may resolve an uncertain prompt we restored. Clear
    // only that still-matching recovery, never a subsequent edit or another pair.
    if (accepted) yield* clearAdmittedDraft(scope.workspaceId, scope.agentId);
    const failedOrUncertain =
      tombstone?.reason === 'rejected' || getItem(entry.submissions, id)?.status === 'uncertain';
    if (
      failedOrUncertain &&
      delivery.recovery &&
      delivery.clearedRevision === draft.revision &&
      !draft.text &&
      selectComposerContextItems.select(appStore.state, scope.workspaceId, scope.agentId).length ===
        0
    ) {
      const items = getItems(delivery.recovery.contextItems);
      yield* put(setComposerContextItems(scope.workspaceId, scope.agentId, items));
      yield* put(
        dockConversationDraftRecovered(
          scope.workspaceId,
          scope.agentId,
          draft.revision,
          JSON.stringify(items),
        ),
      );
    }
  }
}
export function* dockConversationSaga(): SagaGenerator<void> {
  yield* takeEvery(
    dockConversationContextItemsChanged,
    function* ({ payload: [workspaceId, agentId, items] }) {
      const dock = appStore.state.dockConversation;
      if (!dock.authority || dock.authority !== getPrincipalActionContext(appStore.state)) return;
      if (dock.workspaceId !== workspaceId || dock.agentId !== agentId) return;
      const draft = getItem(dock.drafts, JSON.stringify([workspaceId, agentId]));
      if (!draft) return;
      yield* put(setComposerContextItems(workspaceId, agentId, items));
      yield* put(dockConversationDraftChanged(workspaceId, agentId, draft.text));
    },
  );
  yield* takeLatest(
    [
      openDockConversationRequested,
      closeDockConversationRequested,
      selectDockConversationAgentRequested,
      reloadDockConversationRequested,
    ],
    conversationLifetime,
  );
  // Each generation owns its synchronous sending guard; an older target
  // awaiting validation must not suppress a newly selected target's send.
  yield* takeEvery([sendDockConversationRequested, retryDockConversationSendRequested], sendReply);
  // Canonical chat-read owns submission action watchers. The companion observes
  // their resulting state solely to reconcile its own draft revision.
  yield* takeEveryFromSelector(selectPendingSubmissionsState, function* () {
    yield* trackRetryAdmissions();
    yield* reconcileDeliveries();
  });
  yield* takeLatestFromSelector(
    selectPrincipalActionContext,
    function* ({ payload }: SelectorChannelPayload<string | null>) {
      const dock = appStore.state.dockConversation;
      if (dock.workspaceId && dock.authority !== payload)
        yield* put(reloadDockConversationRequested());
    },
  );
}
