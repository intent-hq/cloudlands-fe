import { WorkspaceConversationFilePicker } from './workspace-conversation-file-picker';
import { prepareRepositoryFileContext } from '$lib/components/chat/chat-repository-file-context';
import { selectFileExplorerRoot } from '@/store/file-explorer/file-explorer-selectors';
import { WorkspaceConversationQueue } from './workspace-conversation-queue';
import { Combobox } from '@/components/ui/combobox';
import { ContextChip } from '@/features/chat/components/context-chip';
import { prepareNoteContext } from '$lib/components/chat/chat-note-context';
import {
  selectAvailableContextNotes,
  selectNoteContextValid,
} from '@/store/chat-drafts/note-context-selectors';
import { selectWorkspaceNotesState } from '@/store/workspace-notes/workspace-notes-selectors';
import { selectPrincipalConnectionContext } from '@/store/principal/principal-selectors';
import { workspaceNotesHydrationRequested } from '../../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';
import { getChatDraftEntry } from '../../../../../src/store/renderer/slices/transient-ui/transient-ui-projections';
import {
  setComposerContextItems,
  setChatDraft,
} from '../../../../../src/store/renderer/slices/transient-ui/transient-ui-slice';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { selectAgentModelSubmissionPending } from '@/store/agent-model/agent-model-selectors';
import { WorkspaceConversationModel } from './workspace-conversation-model';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '@/store';
import { PaperclipIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { AttachmentPreview } from '@/features/chat/components/attachment-preview';
import {
  serializeDraftAttachments,
  deserializeDraftAttachments,
} from '$lib/components/chat/chat-draft-attachments';
import {
  extractAttachmentBlocks,
  matchesAttachmentBlocks,
} from '$lib/components/chat/chat-attachment-blocks';
import { getComposerContextEntry } from '../../../../../src/store/renderer/slices/transient-ui/transient-ui-projections';
import {
  composerAttachmentsSelected,
  composerAttachmentRemoved,
  composerAttachmentRetryRequested,
  composerAttachmentsReleased,
} from '../../../../../src/store/renderer/slices/chat-drafts/chat-drafts-slice';
import { MessageComposer } from '@/components/ui/message-composer';
import { ErrorState, LoadingState } from '@/components/patterns/screen';
import {
  selectChatDraftOwnerView,
  selectChatDraft,
  selectComposerContextItems,
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

/** Canonical draft and submission owners drive the public composer. */
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
  const [submitted, setSubmitted] = useState<{ id: string; text: string; attachments: string }>();
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
  const connection = selectPrincipalConnectionContext().value;
  const view = useMemo(
    () => ({ workspaceId, agentId, connection, participation }),
    [workspaceId, agentId, connection, participation],
  );
  const liveView = useRef<typeof view | null>(null);
  useEffect(() => {
    liveView.current = view;
    return () => {
      if (liveView.current === view) liveView.current = null;
    };
  }, [view]);
  const currentView = useCallback(() => {
    return (
      liveView.current === view &&
      mounted.current &&
      !!participation &&
      participation === selectWorkspaceParticipationContext.select(store.state, workspaceId) &&
      connection === selectPrincipalConnectionContext.select(store.state) &&
      store.state.agentSessions.byAgentId[agentId]?.workspaceId === workspaceId
    );
  }, [view, participation, connection, workspaceId, agentId]);
  const notes = selectAvailableContextNotes(workspaceId).value;
  const notesState = selectWorkspaceNotesState(workspaceId).value;
  const modelPending = selectAgentModelSubmissionPending(agentId, workspaceId).value;
  const pending =
    entry &&
    getItems(entry.submissions).some(
      (s) => s.status === 'preparing' || s.status === 'sending' || s.status === 'uncertain',
    );
  const restored = drafts?.restore?.status === 'restored';
  const attachments = selectComposerContextItems(workspaceId, agentId).value;
  const repositoryRoot = selectFileExplorerRoot(workspaceId).value;
  const selectedFiles = attachments.filter((item) => 'repositoryFile' in item);
  const filesValid = prepareRepositoryFileContext(workspaceId, repositoryRoot, attachments).ok;
  const selectedNotes = attachments.filter((item) => item.type === 'note');
  const notesValid = selectNoteContextValid(workspaceId, attachments).value;
  const hasAttachments = attachments.some(
    (item) => item.type !== 'note' && !('repositoryFile' in item),
  );
  const attachmentsBlocked = attachments.some(
    (item) =>
      item.type !== 'note' &&
      !('repositoryFile' in item) &&
      (item.placementStatus === 'placing' ||
        item.placementStatus === 'failed' ||
        (!item.attachmentId && !(item.imageData && item.imageMimeType))),
  );
  const unsupportedAttachments = attachments.some(
    (item) =>
      item.type !== 'note' &&
      !('repositoryFile' in item) &&
      !item.placementStatus &&
      !item.attachmentId &&
      !(item.imageData && item.imageMimeType),
  );
  const attachmentSnapshot = JSON.stringify(serializeDraftAttachments(attachments));
  const dispatch = store.dispatch;
  useEffect(() => {
    mounted.current = true;
    dispatch(chatDraftOwnerOpened(ownerId));
    dispatch(chatDraftRestoreRequested(ownerId, crypto.randomUUID(), workspaceId, agentId));
    return () => {
      mounted.current = false;
      dispatch(composerAttachmentsReleased(ownerId));
      dispatch(chatDraftOwnerReleased(ownerId));
    };
  }, [ownerId, workspaceId, agentId, dispatch]);
  useEffect(() => {
    const restore = drafts?.restore;
    if (!restore || restore.status !== 'restored' || appliedRestore.current === restore.requestId)
      return;
    appliedRestore.current = restore.requestId;
    lastPersisted.current = restore.draft ?? { text: '', attachments: [] };
    const localAttachments = getComposerContextEntry(store.state, workspaceId, agentId);
    if (localAttachments === undefined)
      dispatch(
        setComposerContextItems(
          workspaceId,
          agentId,
          deserializeDraftAttachments(lastPersisted.current.attachments),
          true,
        ),
      );
    const local = getChatDraftEntry(store.state, workspaceId, agentId);
    if (local === undefined)
      dispatch(setChatDraft(workspaceId, agentId, lastPersisted.current.text, true));
    if (
      (local !== undefined && local !== lastPersisted.current.text) ||
      (localAttachments !== undefined &&
        JSON.stringify(serializeDraftAttachments(localAttachments)) !==
          JSON.stringify(lastPersisted.current.attachments))
    ) {
      // Reconcile only draft persistence; reconnect never resends a chat message.
      const requestId = crypto.randomUUID();
      const snapshot = {
        text: local ?? lastPersisted.current.text,
        attachments:
          localAttachments === undefined
            ? lastPersisted.current.attachments
            : serializeDraftAttachments(localAttachments),
      };
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
    if (!currentView() || !submitted || !entry || settledSubmission.current === submitted.id)
      return;
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
    if (
      selectChatDraft.select(store.state, workspaceId, agentId) !== submitted.text ||
      JSON.stringify(
        serializeDraftAttachments(
          selectComposerContextItems.select(store.state, workspaceId, agentId),
        ),
      ) !== submitted.attachments
    )
      return;
    dispatch(chatDraftSaveCancelled(ownerId));
    dispatch(chatDraftClearRequested(workspaceId, agentId));
    saveSnapshots.current.clear();
    lastPersisted.current = { text: '', attachments: [] };
    dispatch(setChatDraft(workspaceId, agentId, '', true));
    dispatch(setComposerContextItems(workspaceId, agentId, [], true));
  }, [
    submitted,
    entry,
    value,
    attachmentSnapshot,
    dispatch,
    ownerId,
    workspaceId,
    agentId,
    currentView,
  ]);
  function edit(text: string) {
    if (!currentView()) return;
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
      attachments: serializeDraftAttachments(
        selectComposerContextItems.select(store.state, workspaceId, agentId),
      ),
    });
    dispatch(
      chatDraftSaveScheduled(ownerId, requestId, {
        workspaceId,
        agentId,
        text,
        attachments: serializeDraftAttachments(
          selectComposerContextItems.select(store.state, workspaceId, agentId),
        ),
        rollback: lastPersisted.current,
      }),
    );
  }
  function send(text: string, enqueue = false) {
    if (
      !currentView() ||
      !restored ||
      !transcriptReady ||
      submitting.current ||
      attachmentsBlocked ||
      selectAgentModelSubmissionPending.select(store.state, agentId, workspaceId) ||
      pending ||
      !participation ||
      principal?.capabilities.submissionCorrelation !== 1
    )
      return;
    const items = selectComposerContextItems.select(store.state, workspaceId, agentId);
    const composerText = selectChatDraft.select(store.state, workspaceId, agentId);
    if (enqueue && (items.length > 0 || !selectAgentIsResponding.select(store.state, agentId)))
      return;
    if (
      items.some((item) => item.placementStatus === 'placing' || item.placementStatus === 'failed')
    )
      return;
    const context = prepareNoteContext(workspaceId, items);
    const fileContext = prepareRepositoryFileContext(
      workspaceId,
      selectFileExplorerRoot.select(store.state, workspaceId),
      items,
    );
    if (!fileContext.ok) {
      setLocalError(m.chat_fileContext_unavailable_error());
      return;
    }
    if (!context.ok || !selectNoteContextValid.select(store.state, workspaceId, items)) {
      setLocalError(m.chat_noteContext_unavailable_error());
      return;
    }
    if (
      (context.noteIds.length || fileContext.contextReferences.length) &&
      selectAgentIsResponding.select(store.state, agentId)
    ) {
      setLocalError(m.chat_fileContext_busy_description());
      return;
    }
    const noteContext =
      context.noteIds.length || fileContext.contextReferences.length
        ? {
            noteIds: context.noteIds,
            composerText,
            noteContextOwnerId: ownerId,
            contextReferences: [...context.contextReferences, ...fileContext.contextReferences],
            workspaceContextStr: [context.workspaceContextStr, fileContext.workspaceContextStr]
              .filter(Boolean)
              .join('\n'),
            contextItems: items,
          }
        : {};
    const blocks = extractAttachmentBlocks(items);
    const admitted = chatSubmission.admitChatMessage(store, agentId, {
      wsId: workspaceId,
      text,
      ...noteContext,
      ...blocks,
      ...(enqueue ? { queueOwnerId: ownerId } : {}),
    });
    if (!admitted) {
      setLocalError(m.agent_streamLifecycle_sendFailed_error());
      return;
    }
    submitting.current = admitted.submission.id;
    setSubmitted({
      id: admitted.submission.id,
      text: composerText,
      attachments: JSON.stringify(serializeDraftAttachments(items)),
    });
    dispatch(
      sendMessage(agentId, {
        wsId: workspaceId,
        text,
        ...noteContext,
        ...blocks,
        ...(enqueue ? { queueOwnerId: ownerId } : {}),
        userAppMessageId: admitted.submission.appMessageId,
        submission: { scope: admitted.scope, id: admitted.submission.id },
      }),
    );
  }
  function selectContextNote(noteId: string) {
    if (!currentView() || !restored) return;
    const note = selectAvailableContextNotes
      .select(store.state, workspaceId)
      .find((item) => item.id === noteId);
    if (!note) return;
    const items = selectComposerContextItems.select(store.state, workspaceId, agentId);
    if (
      items.some(
        (item) =>
          item.type === 'note' && item.workspaceId === workspaceId && item.noteId === noteId,
      )
    )
      return;
    dispatch(
      setComposerContextItems(
        workspaceId,
        agentId,
        [
          ...items,
          {
            id: crypto.randomUUID(),
            type: 'note',
            workspaceId,
            noteId,
            label: note.title,
          },
        ],
        true,
      ),
    );
    edit(selectChatDraft.select(store.state, workspaceId, agentId));
  }
  function selectContextFile(path: string, root: string) {
    if (
      !currentView() ||
      !restored ||
      selectFileExplorerRoot.select(store.state, workspaceId) !== root
    )
      return;
    const items = selectComposerContextItems.select(store.state, workspaceId, agentId);
    if (
      items.some(
        (item) =>
          item.repositoryFile?.workspaceId === workspaceId &&
          item.repositoryFile?.rootPath === root &&
          item.repositoryFile?.path === path,
      )
    )
      return;
    const item = {
      id: crypto.randomUUID(),
      type: 'file' as const,
      label: path,
      repositoryFile: { workspaceId, rootPath: root, path },
    };
    if (!prepareRepositoryFileContext(workspaceId, root, [item]).ok) return;
    dispatch(setComposerContextItems(workspaceId, agentId, [...items, item], true));
    edit(selectChatDraft.select(store.state, workspaceId, agentId));
  }
  function removeContextNote(id: string) {
    if (!currentView()) return;
    const items = selectComposerContextItems.select(store.state, workspaceId, agentId);
    dispatch(
      setComposerContextItems(
        workspaceId,
        agentId,
        items.filter((item) => item.id !== id),
        true,
      ),
    );
    edit(selectChatDraft.select(store.state, workspaceId, agentId));
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
      <div className="flex min-w-0 flex-wrap gap-2" data-testid="composer-attachments">
        {selectedFiles.map((item) => (
          <ContextChip
            key={item.id}
            type="file"
            label={item.repositoryFile?.path ?? item.label}
            tooltip={item.repositoryFile?.path ?? item.label}
            removable
            onRemove={() => removeContextNote(item.id)}
          />
        ))}
        {selectedNotes.map((item) => (
          <ContextChip
            key={item.id}
            type="note"
            label={item.label}
            tooltip={`${item.label} (${item.noteId ?? item.id})`}
            removable
            onRemove={() => removeContextNote(item.id)}
          />
        ))}
        {attachments
          .filter((item) => item.type !== 'note' && !('repositoryFile' in item))
          .map((item) => (
            <AttachmentPreview
              key={item.id}
              id={item.id}
              name={item.label}
              type={item.attachmentMimeType ?? item.imageMimeType ?? ''}
              size={item.attachmentSize}
              imageData={item.imageData}
              imageMimeType={item.imageMimeType}
              placementStatus={item.placementStatus}
              placementError={
                item.placementStatus === 'failed' && !item.placementIdempotencyKey
                  ? m.chat_composer_attachmentReselect_description()
                  : item.placementError
              }
              onRemove={(id) =>
                dispatch(composerAttachmentRemoved(ownerId, workspaceId, agentId, id))
              }
              onRetry={
                item.placementIdempotencyKey
                  ? (id) =>
                      dispatch(composerAttachmentRetryRequested(ownerId, workspaceId, agentId, id))
                  : undefined
              }
            />
          ))}
      </div>
      {!notesValid && (
        <ErrorState
          density="compact"
          message={m.chat_noteContext_unavailable_error()}
          retryLabel={m.ui_combobox_retry_label()}
          onRetry={() => {
            if (currentView())
              dispatch(
                workspaceNotesHydrationRequested(
                  workspaceId,
                  store.state.workspaceEvents.subscriptionGeneration,
                  true,
                ),
              );
          }}
        />
      )}
      {!filesValid && (
        <ErrorState density="compact" message={m.chat_fileContext_unavailable_error()} />
      )}
      {(selectedNotes.length > 0 || selectedFiles.length > 0) && responding && (
        <p className="type-caption text-muted-foreground">
          {m.chat_fileContext_busy_description()}
        </p>
      )}
      {error && (
        <ErrorState
          density="compact"
          message={error}
          retryLabel={m.ui_combobox_retry_label()}
          onRetry={() => {
            if (!currentView()) return;
            setLocalError(undefined);
            if (!restored)
              dispatch(
                chatDraftRestoreRequested(ownerId, crypto.randomUUID(), workspaceId, agentId),
              );
            else if (chat.lastAttemptedMessage?.submission)
              void submissionRetry
                .requestChatMessageRetry(
                  agentId,
                  workspaceId,
                  undefined,
                  (id) => {
                    if (!currentView()) return;
                    submitting.current = id;
                    const currentItems = selectComposerContextItems.select(
                      store.state,
                      workspaceId,
                      agentId,
                    );
                    setSubmitted({
                      id,
                      text:
                        chat.lastAttemptedMessage?.options?.composerText ??
                        chat.lastAttemptedMessage?.text ??
                        '',
                      attachments:
                        matchesAttachmentBlocks(currentItems, chat.lastAttemptedMessage?.options) &&
                        JSON.stringify(
                          serializeDraftAttachments(
                            currentItems.filter(
                              (item) => item.type === 'note' || 'repositoryFile' in item,
                            ),
                          ),
                        ) ===
                          JSON.stringify(
                            serializeDraftAttachments(
                              (chat.lastAttemptedMessage?.options?.contextItems ?? []).filter(
                                (item) => item.type === 'note' || 'repositoryFile' in item,
                              ),
                            ),
                          )
                          ? JSON.stringify(serializeDraftAttachments(currentItems))
                          : '',
                    });
                  },
                  ownerId,
                )
                .catch((e) => {
                  if (currentView()) setLocalError(String(e));
                });
            else edit(value);
          }}
        />
      )}
      <Combobox
        value=""
        options={notes
          .filter(
            (note) =>
              !selectedNotes.some(
                (item) => item.noteId === note.id && item.workspaceId === workspaceId,
              ),
          )
          .map((note) => ({ value: note.id, label: note.title, description: note.id }))}
        ariaLabel={m.chat_noteContext_add_label()}
        placeholder={m.chat_noteContext_add_label()}
        searchPlaceholder={m.chat_noteContext_search_placeholder()}
        emptyText={m.chat_noteContext_empty_description()}
        loading={notesState.loading}
        disabled={!restored || !participation}
        onChange={(id) => {
          if (typeof id === 'string') selectContextNote(id);
        }}
      />
      {notesState.error && (
        <ErrorState
          density="compact"
          message={notesState.error}
          retryLabel={m.ui_combobox_retry_label()}
          onRetry={() => {
            if (currentView())
              dispatch(
                workspaceNotesHydrationRequested(
                  workspaceId,
                  store.state.workspaceEvents.subscriptionGeneration,
                  true,
                ),
              );
          }}
        />
      )}
      <WorkspaceConversationFilePicker
        workspaceId={workspaceId}
        disabled={!restored || !participation}
        onSelect={selectContextFile}
      />
      <WorkspaceConversationQueue workspaceId={workspaceId} agentId={agentId} ownerId={ownerId} />
      <MessageComposer
        value={value}
        onValueChange={edit}
        onSend={(text) => send(text)}
        onEnqueue={(text) => send(text, true)}
        enqueueDisabled={attachments.length > 0 || !!pending}
        hasAttachments={hasAttachments}
        sendDisabled={
          attachmentsBlocked ||
          modelPending ||
          !notesValid ||
          !filesValid ||
          ((selectedNotes.length > 0 || selectedFiles.length > 0) && responding)
        }
        accept=""
        files={[]}
        onFilesChange={(files) => {
          if (files.length)
            dispatch(composerAttachmentsSelected(ownerId, workspaceId, agentId, files));
        }}
        rightSlot={() =>
          responding && value.trim() && !attachments.length ? (
            <Button
              size="sm"
              variant="plain"
              onClick={() => {
                if (currentView())
                  void dispatch(agentSessionStopChatRequested(agentId)).catch((error) =>
                    setLocalError(String(error)),
                  );
              }}
            >
              {m.chat_richInput_stop_label()}
            </Button>
          ) : null
        }
        leftSlot={({ openFilePicker }) => (
          <>
            <WorkspaceConversationModel
              workspaceId={workspaceId}
              agentId={agentId}
              disabled={
                !restored || !transcriptReady || !participation || (!!pending && !responding)
              }
              responding={responding}
            />
            <Button
              variant="plain"
              size="icon-sm"
              iconOnly
              aria-label={m.chat_richInput_attachFiles_label()}
              onClick={() => openFilePicker()}
            >
              <PaperclipIcon size={16} />
            </Button>
          </>
        )}
        status={responding ? 'streaming' : 'idle'}
        disabled={
          unsupportedAttachments ||
          !restored ||
          !transcriptReady ||
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
