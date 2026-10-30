import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItem,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
import {
  ackDockInsertion,
  addDockMark,
  applyDockCapture,
  dockEvidenceFingerprint,
  dockEvidenceId,
  emptyDockEvidence,
  enqueueDockInsertion,
  readyDockInsertions,
  rejectDockMark,
  patchDockEvidence,
  removeDockImage,
  boundDockInterim,
  removeDockMark,
  undoDockAnnotationMark,
  redoDockAnnotationMark,
  type DockParkedImage,
  setDockClip,
  applyDockReferenceEdit,
  undoDockMark,
  type DockReferenceEdit,
  type DockAnnotationSession,
  type DockComposerEvidence,
  type DockDictationSession,
  type DockEvidenceCapabilities,
  type DockEvidenceClip,
  type DockImagePlacementRecord,
  type DockServerCapabilities,
  type DockInsertionPart,
  type DockEvidenceErrorCode,
  type DockEvidenceImage,
  type DockEvidenceInsertion,
  type DockMark,
  type DockMarkTool,
} from '$shared/dock-evidence';
import type { DockSpeechCapability } from '$shared/dock-speech';
import type { DockEvidencePrivacyPane } from '$shared/dock-evidence-ipc';
import type { DockAnnotationIssue, DockAnnotationMediaState } from '$shared/dock-annotation';
import type {
  DockConversationAgent,
  DockConversationDraft,
  DockConversationState,
  DockConversationPrompt,
  DockNativeSpeechState,
} from './dock-conversation-types';

export const openDockConversationRequested =
  createAction<[workspaceId: string]>('dockConversation/open');
export const closeDockConversationRequested = createAction<[]>('dockConversation/close');
export const selectDockConversationAgentRequested = createAction<[agentId: string]>(
  'dockConversation/selectAgent',
);
export const reloadDockConversationRequested = createAction<[]>('dockConversation/reload');
export const sendDockConversationRequested =
  createAction<[prompt?: DockConversationPrompt]>('dockConversation/send');
export const dockConversationContextItemsChanged = createAction<
  [workspaceId: string, agentId: string, items: DockConversationPrompt['contextItems']]
>('dockConversation/contextItemsChanged');
export const retryDockConversationSendRequested = createAction<[]>('dockConversation/retrySend');
export const dockConversationContextSet = createAction<[identity: string, authority: string]>(
  'dockConversation/contextSet',
);
export const dockConversationLoaded =
  createAction<
    [
      generation: number,
      workspaceId: string,
      title: string,
      agents: DockConversationAgent[],
      agentId: string | null,
    ]
  >('dockConversation/loaded');
export const dockConversationFailed =
  createAction<[generation: number, error: string]>('dockConversation/failed');
export const dockConversationDraftChanged = createAction<
  [workspaceId: string, agentId: string, text: string]
>('dockConversation/draftChanged');
export const dockConversationDraftRestored = createAction<
  [workspaceId: string, agentId: string, text: string, hasAttachments: boolean]
>('dockConversation/draftRestored');
export const dockConversationDeliverySettled = createAction<
  [workspaceId: string, agentId: string, submissionId: string]
>('dockConversation/deliverySettled');
export const dockConversationRetryArmed = createAction<
  [workspaceId: string, agentId: string, revision: number]
>('dockConversation/retryArmed');
export const dockConversationDeliveryTracked = createAction<
  [workspaceId: string, agentId: string, delivery: NonNullable<DockConversationDraft['delivery']>]
>('dockConversation/deliveryTracked');
export const dockConversationDraftAdmitted = createAction<
  [workspaceId: string, agentId: string, revision: number]
>('dockConversation/draftAdmitted');
export const dockConversationDraftRecovered = createAction<
  [workspaceId: string, agentId: string, revision: number, contextFingerprint: string]
>('dockConversation/draftRecovered');
export const dockConversationSendState = createAction<
  [generation: number, sending: boolean, error: string | null]
>('dockConversation/sendState');

// Screen evidence. Requests are saga-owned (native boundary, context items);
// the remaining actions are pure, pair-scoped evidence transitions.
type Pair = [workspaceId: string, agentId: string];
export const dockEvidenceCaptureRequested = createAction<Pair>(
  'dockConversation/evidenceCaptureRequested',
);
export const dockEvidenceAnnotationToggleRequested = createAction<
  [workspaceId: string, agentId: string, stillImageId?: string]
>('dockConversation/evidenceAnnotationToggleRequested');
export const dockEvidenceToolSelectRequested = createAction<
  [workspaceId: string, agentId: string, tool: DockMarkTool]
>('dockConversation/evidenceToolSelectRequested');
/** Mouse mode in the open annotate session (keys M or 0); a tool resumes annotating. */
export const dockEvidenceMouseModeRequested = createAction<Pair>(
  'dockConversation/evidenceMouseModeRequested',
);
export const dockEvidenceRecordToggleRequested = createAction<Pair>(
  'dockConversation/evidenceRecordToggleRequested',
);
/** The composer's Screenshot/Record state, mirrored on the annotate tool bar (saga only). */
export const dockEvidenceBarMediaChanged = createAction<
  [workspaceId: string, agentId: string, media: DockAnnotationMediaState]
>('dockConversation/evidenceBarMediaChanged');
export const dockEvidenceImageRemoveRequested = createAction<
  [workspaceId: string, agentId: string, imageId: string]
>('dockConversation/evidenceImageRemoveRequested');
export const dockEvidenceClipRemoveRequested = createAction<
  [workspaceId: string, agentId: string, clipId: string]
>('dockConversation/evidenceClipRemoveRequested');
/** Dispatched synchronously by the retiring native owner, before a successor installs. */
export const dockEvidenceSessionRetired = createAction<
  [workspaceId: string, agentId: string, insertionId: string]
>('dockConversation/evidenceSessionRetired');
export const dockEvidenceCaptureStarted = createAction<Pair>(
  'dockConversation/evidenceCaptureStarted',
);
export const dockEvidenceCaptureFailed = createAction<
  [workspaceId: string, agentId: string, error: DockEvidenceErrorCode]
>('dockConversation/evidenceCaptureFailed');
export const dockEvidenceImageCaptured = createAction<
  [workspaceId: string, agentId: string, image: DockEvidenceImage]
>('dockConversation/evidenceImageCaptured');
export const dockEvidenceImageRemoved = createAction<
  [workspaceId: string, agentId: string, imageId: string]
>('dockConversation/evidenceImageRemoved');
export const dockEvidenceMarkAdded = createAction<
  [workspaceId: string, agentId: string, mark: DockMark]
>('dockConversation/evidenceMarkAdded');
export const dockEvidenceMarkRemoved = createAction<
  [workspaceId: string, agentId: string, markId: string]
>('dockConversation/evidenceMarkRemoved');
export const dockEvidenceMarkUndone = createAction<Pair>('dockConversation/evidenceMarkUndone');
/** Cmd/Ctrl+Z while annotating: undo the session's newest mark (redoable). */
export const dockEvidenceAnnotationUndoRequested = createAction<Pair>(
  'dockConversation/evidenceAnnotationUndoRequested',
);
/** Cmd/Ctrl+Shift+Z while annotating: redo the newest undone mark. */
export const dockEvidenceAnnotationRedoRequested = createAction<Pair>(
  'dockConversation/evidenceAnnotationRedoRequested',
);
export const dockEvidenceAnnotationUndone = createAction<
  [workspaceId: string, agentId: string, parked: DockParkedImage | null]
>('dockConversation/evidenceAnnotationUndone');
export const dockEvidenceAnnotationRedone = createAction<Pair>(
  'dockConversation/evidenceAnnotationRedone',
);
/** A user text edit deleted or brought back reference chips; marks follow their chips. */
export const dockEvidenceReferencesEdited = createAction<
  [workspaceId: string, agentId: string, edit: DockReferenceEdit]
>('dockConversation/evidenceReferencesEdited');
/** Explicit settlement: the renderer refused this native gesture id; drop only its speech chip. */
export const dockEvidenceMarkRejected = createAction<
  [workspaceId: string, agentId: string, markId: string]
>('dockConversation/evidenceMarkRejected');
export const dockEvidenceInsertionQueued = createAction<
  [workspaceId: string, agentId: string, insertion: DockEvidenceInsertion]
>('dockConversation/evidenceInsertionQueued');
/**
 * Exactly-once editor commit: after its transaction applied the HEAD insertion,
 * the editor reports the resulting draft text against the draft revision it
 * mirrored. One reducer step writes that text and removes the insertion, so a
 * remount between a text write and an acknowledgement cannot duplicate
 * narration, and a late or duplicate commit never overwrites newer typing.
 */
export const dockEvidenceInsertionCommitted = createAction<
  [
    workspaceId: string,
    agentId: string,
    insertionId: string,
    committedText: string,
    expectedDraftRevision: number,
  ]
>('dockConversation/evidenceInsertionCommitted');
/** Live interim transcript for exactly the named dictation; replaced, never sent. */
export const dockEvidenceDictationInterim = createAction<
  [workspaceId: string, agentId: string, dictationId: string, parts: DockInsertionPart[]]
>('dockConversation/evidenceDictationInterim');
/** Resumable pre-admission placement progress for one still-present image. */
export const dockEvidencePlacementRecorded = createAction<
  [workspaceId: string, agentId: string, record: DockImagePlacementRecord]
>('dockConversation/evidencePlacementRecorded');
/** Publish capabilities read from one connection's acknowledged hello. */
export const dockEvidenceServerCapabilitiesObserved = createAction<
  [capabilities: DockServerCapabilities]
>('dockConversation/evidenceServerCapabilitiesObserved');
/** Ask the controller to re-read the current connection's capabilities. */
export const dockEvidenceServerCapabilitiesProbeRequested = createAction<[]>(
  'dockConversation/evidenceServerCapabilitiesProbeRequested',
);
export const dockEvidenceCapabilitiesChanged = createAction<
  [capabilities: DockEvidenceCapabilities | null]
>('dockConversation/evidenceCapabilitiesChanged');
export const dockEvidenceToolSet = createAction<[workspaceId: string, tool: DockMarkTool]>(
  'dockConversation/evidenceToolSet',
);
export const dockEvidenceToolRemembered = createAction<[workspaceId: string, tool: DockMarkTool]>(
  'dockConversation/evidenceToolRemembered',
);
export const dockEvidenceAnnotationChanged = createAction<
  [workspaceId: string, agentId: string, annotation: DockAnnotationSession | null]
>('dockConversation/evidenceAnnotationChanged');
export const dockEvidenceDictationChanged = createAction<
  [workspaceId: string, agentId: string, dictation: DockDictationSession | null]
>('dockConversation/evidenceDictationChanged');
/** Ends exactly the named dictation and queues its transcript as one insertion. */
export const dockEvidenceDictationFinished = createAction<
  [
    workspaceId: string,
    agentId: string,
    dictationId: string,
    insertion: DockEvidenceInsertion | null,
  ]
>('dockConversation/evidenceDictationFinished');
/** Add or update one clip by id; null removes that clip only. */
export const dockEvidenceClipChanged = createAction<
  [workspaceId: string, agentId: string, clipId: string, clip: DockEvidenceClip | null]
>('dockConversation/evidenceClipChanged');
/** Clears only the evidence content (fingerprint) an admitted send owned. */
export const dockEvidenceCleared = createAction<
  [workspaceId: string, agentId: string, fingerprint: string]
>('dockConversation/evidenceCleared');
/** Ends an active annotate session (typing, Escape, send); marks stay. */
export const dockEvidenceAnnotationEndRequested = createAction<Pair>(
  'dockConversation/evidenceAnnotationEndRequested',
);
/** Restore from a draft or failed delivery; never overwrites live evidence. */
export const dockEvidenceRestored = createAction<
  [workspaceId: string, agentId: string, evidence: DockComposerEvidence]
>('dockConversation/evidenceRestored');

/** An actionable annotate failure of the pair's live session (null clears it). */
export const dockEvidenceAnnotationIssue = createAction<
  [workspaceId: string, agentId: string, issue: DockAnnotationIssue | null]
>('dockConversation/evidenceAnnotationIssue');
/** The root native-session saga installed (pairId) or retired (null) the open pair's adapter. */
export const dockNativeSpeechSessionChanged = createAction<
  [pairId: string | null, capability: DockSpeechCapability | null]
>('dockConversation/nativeSpeechSessionChanged');
/** Saga-only mirror of the live speech session; ignored for any other pair. */
export const dockNativeSpeechPatched = createAction<
  [pairId: string, patch: Partial<Pick<DockNativeSpeechState, 'activeId' | 'pending' | 'error'>>]
>('dockConversation/nativeSpeechPatched');
export const dockNativeSpeechLevel = createAction<[pairId: string, level: number]>(
  'dockConversation/nativeSpeechLevel',
);
export const dockNativeSpeechStopSettled = createAction<
  [pairId: string, requestId: string, ok: boolean]
>('dockConversation/nativeSpeechStopSettled');
export const dockSpeechStartRequested = createAction<Pair>('dockConversation/speechStartRequested');
/** Stop at the final-transcript barrier; `requestId` correlates the settled outcome. */
export const dockSpeechStopRequested = createAction<
  [workspaceId: string, agentId: string, requestId: string]
>('dockConversation/speechStopRequested');
/**
 * Send could not wait any longer for the final transcript: end speech now and
 * keep its live (interim) words as typed text. Native's late final is ignored.
 */
export const dockSpeechKeepLiveRequested = createAction<Pair>(
  'dockConversation/speechKeepLiveRequested',
);
export const dockSpeechToggleRequested = createAction<Pair>(
  'dockConversation/speechToggleRequested',
);
/** User click only: open the OS privacy pane native names. */
/**
 * Feedback entry points (dock row pens, the dock action menu): open that workspace's
 * conversation, then start an annotate session with the current tool.
 */
export const dockFeedbackRequested = createAction<[workspaceId: string, agentId?: string]>(
  'dockConversation/feedbackRequested',
);
export const dockEvidenceOpenSettingsRequested = createAction<
  [workspaceId: string, agentId: string, pane: DockEvidencePrivacyPane]
>('dockConversation/evidenceOpenSettingsRequested');

const DOCK_SPEECH_LEVELS = 96;
const DOCK_SPEECH_STOPS = 16;
const emptyNativeSpeech: DockNativeSpeechState = {
  pairId: null,
  capability: null,
  activeId: null,
  pending: false,
  error: null,
  levels: [],
  stops: [],
};

export const dockConversationReducer = createReducer<DockConversationState>({
  workspaceId: null,
  workspaceTitle: '',
  agentId: null,
  generation: 0,
  identity: null,
  authority: null,
  agents: createCollection('id'),
  drafts: createCollection('id'),
  evidence: createCollection('id'),
  toolByWorkspace: {},
  rememberedToolByWorkspace: {},
  nativeCapabilities: null,
  serverCapabilities: null,
  nativeSpeech: emptyNativeSpeech,
  loading: false,
  error: null,
  sendError: null,
  sending: false,
});
dockConversationReducer.with(
  dockNativeSpeechSessionChanged,
  (state, { payload: [pairId, capability] }) => ({
    ...state,
    nativeSpeech: { ...emptyNativeSpeech, pairId, capability: pairId ? capability : null },
  }),
);
dockConversationReducer.with(dockNativeSpeechPatched, (state, { payload: [pairId, patch] }) =>
  state.nativeSpeech.pairId === pairId
    ? {
        ...state,
        nativeSpeech: {
          ...state.nativeSpeech,
          ...patch,
          // A new or stopped session never carries a stale input meter.
          ...(patch.activeId !== undefined && patch.activeId !== state.nativeSpeech.activeId
            ? { levels: [] }
            : {}),
        },
      }
    : state,
);
dockConversationReducer.with(dockNativeSpeechLevel, (state, { payload: [pairId, level] }) =>
  state.nativeSpeech.pairId === pairId && state.nativeSpeech.activeId && Number.isFinite(level)
    ? {
        ...state,
        nativeSpeech: {
          ...state.nativeSpeech,
          levels: [...state.nativeSpeech.levels, Math.max(0, Math.min(1, level))].slice(
            -DOCK_SPEECH_LEVELS,
          ),
        },
      }
    : state,
);
dockConversationReducer.with(
  dockNativeSpeechStopSettled,
  (state, { payload: [pairId, requestId, ok] }) =>
    state.nativeSpeech.pairId === pairId
      ? {
          ...state,
          nativeSpeech: {
            ...state.nativeSpeech,
            stops: [
              ...state.nativeSpeech.stops.filter((row) => row.requestId !== requestId),
              { requestId, ok },
            ].slice(-DOCK_SPEECH_STOPS),
          },
        }
      : state,
);
dockConversationReducer.with(
  openDockConversationRequested,
  (state, { payload: [workspaceId] }) => ({
    ...state,
    workspaceId,
    workspaceTitle: '',
    agentId: null,
    agents: createCollection('id'),
    generation: state.generation + 1,
    loading: true,
    error: null,
    sendError: null,
    sending: false,
  }),
);
dockConversationReducer.with(closeDockConversationRequested, (state) => ({
  ...state,
  workspaceId: null,
  agentId: null,
  generation: state.generation + 1,
  loading: false,
  sending: false,
}));
dockConversationReducer.with(
  selectDockConversationAgentRequested,
  (state, { payload: [agentId] }) =>
    getItem(state.agents, agentId)
      ? {
          ...state,
          agentId,
          generation: state.generation + 1,
          loading: true,
          error: null,
          sendError: null,
          sending: false,
        }
      : state,
);
dockConversationReducer.with(reloadDockConversationRequested, (state) => ({
  ...state,
  generation: state.generation + 1,
  loading: !!state.workspaceId,
  error: null,
}));
dockConversationReducer.with(
  dockConversationContextSet,
  (state, { payload: [identity, authority] }) => ({
    ...state,
    identity,
    authority,
    drafts: state.identity && state.identity !== identity ? createCollection('id') : state.drafts,
    evidence:
      state.identity && state.identity !== identity ? createCollection('id') : state.evidence,
    // A new principal/backend identity must re-observe what its connection advertises.
    serverCapabilities:
      state.identity && state.identity !== identity ? null : state.serverCapabilities,
  }),
);
dockConversationReducer.with(
  dockConversationLoaded,
  (state, { payload: [generation, workspaceId, workspaceTitle, agents, agentId] }) =>
    generation === state.generation && workspaceId === state.workspaceId
      ? {
          ...state,
          workspaceTitle,
          agents: createCollection('id', agents),
          agentId,
          loading: false,
          error: null,
        }
      : state,
);
dockConversationReducer.with(dockConversationFailed, (state, { payload: [generation, error] }) =>
  generation === state.generation ? { ...state, loading: false, error } : state,
);
function draftFor(
  state: DockConversationState,
  workspaceId: string,
  agentId: string,
): DockConversationDraft {
  const id = JSON.stringify([workspaceId, agentId]);
  return (
    getItem(state.drafts, id) ?? {
      id,
      text: '',
      revision: 0,
      restored: false,
      hasAttachments: false,
    }
  );
}
dockConversationReducer.with(
  dockConversationDraftChanged,
  (state, { payload: [ws, agent, text] }) => {
    const draft = draftFor(state, ws, agent);
    return {
      ...state,
      drafts: upsertItem(state.drafts, { ...draft, text, revision: draft.revision + 1 }),
      sendError: null,
    };
  },
);
dockConversationReducer.with(
  dockConversationDraftRestored,
  (state, { payload: [ws, agent, text, hasAttachments] }) => {
    const draft = draftFor(state, ws, agent);
    return {
      ...state,
      drafts: upsertItem(state.drafts, {
        ...draft,
        text: draft.revision === 0 ? text : draft.text,
        restored: true,
        hasAttachments,
      }),
    };
  },
);
dockConversationReducer.with(
  dockConversationDraftAdmitted,
  (state, { payload: [ws, agent, revision] }) => {
    const draft = draftFor(state, ws, agent);
    return draft.revision === revision
      ? {
          ...state,
          drafts: upsertItem(state.drafts, {
            ...draft,
            text: '',
            revision: revision + 1,
            hasAttachments: false,
            clearRevision: revision + 1,
            clearSubmissionId: draft.delivery?.composerSubmissionId,
            delivery: draft.delivery
              ? { ...draft.delivery, clearedRevision: revision + 1 }
              : undefined,
            retryRevision: undefined,
          }),
        }
      : state;
  },
);
dockConversationReducer.with(
  dockConversationSendState,
  (state, { payload: [generation, sending, sendError] }) =>
    generation === state.generation ? { ...state, sending, sendError } : state,
);

dockConversationReducer.with(
  dockConversationDeliveryTracked,
  (state, { payload: [ws, agent, delivery] }) => {
    const draft = draftFor(state, ws, agent);
    return {
      ...state,
      drafts: upsertItem(state.drafts, { ...draft, delivery, retryRevision: undefined }),
    };
  },
);

dockConversationReducer.with(
  dockConversationRetryArmed,
  (state, { payload: [ws, agent, retryRevision] }) => {
    const draft = draftFor(state, ws, agent);
    return { ...state, drafts: upsertItem(state.drafts, { ...draft, retryRevision }) };
  },
);

dockConversationReducer.with(
  dockConversationDeliverySettled,
  (state, { payload: [ws, agent, submissionId] }) => {
    const draft = draftFor(state, ws, agent);
    return draft.delivery?.reference.id === submissionId
      ? {
          ...state,
          drafts: upsertItem(state.drafts, {
            ...draft,
            delivery: { ...draft.delivery, settled: true },
          }),
        }
      : state;
  },
);

// A failed/uncertain send may restore only the untouched empty prompt it created.
dockConversationReducer.with(
  dockConversationDraftRecovered,
  (state, { payload: [ws, agent, revision, contextFingerprint] }) => {
    const draft = draftFor(state, ws, agent);
    const recovery = draft.delivery?.recovery;
    if (!recovery || draft.revision !== revision || draft.delivery?.clearedRevision !== revision)
      return state;
    return {
      ...state,
      drafts: upsertItem(state.drafts, {
        ...draft,
        text: recovery.text,
        revision: revision + 1,
        recoverRevision: revision + 1,
        delivery: {
          ...draft.delivery,
          revision: revision + 1,
          contextFingerprint,
          clearedRevision: undefined,
        },
      }),
    };
  },
);

function evidenceFor(
  state: DockConversationState,
  workspaceId: string,
  agentId: string,
): DockComposerEvidence {
  const id = dockEvidenceId(workspaceId, agentId);
  return getItem(state.evidence, id) ?? emptyDockEvidence(id);
}
function withEvidence(
  state: DockConversationState,
  workspaceId: string,
  agentId: string,
  update: (evidence: DockComposerEvidence) => DockComposerEvidence,
): DockConversationState {
  const current = evidenceFor(state, workspaceId, agentId);
  const next = update(current);
  return next === current ? state : { ...state, evidence: upsertItem(state.evidence, next) };
}
const isEmpty = (evidence: DockComposerEvidence) =>
  !evidence.images.length && !evidence.clips.length && !evidence.marks.length;

dockConversationReducer.with(
  dockEvidenceSessionRetired,
  (state, { payload: [ws, agent, insertionId] }) =>
    withEvidence(state, ws, agent, (e) => {
      // Use normal removal so queued speech loses references to cancelled clips.
      const settled = e.clips.reduce(
        (current, clip) => clip.status === 'recording' ? setDockClip(current, clip.id, null) : current,
        e,
      );
      const parts = settled.dictation?.interim;
      const retired = patchDockEvidence(settled, {
        capture: { ...e.capture, pending: false },
        dictation: null,
        annotation: null,
        annotationHistory: null,
      });
      return parts?.length
        ? enqueueDockInsertion(retired, { id: insertionId, parts: [...parts] })
        : retired;
    }),
);
dockConversationReducer.with(dockEvidenceCaptureStarted, (state, { payload: [ws, agent] }) =>
  withEvidence(state, ws, agent, (e) =>
    patchDockEvidence(e, { capture: { ...e.capture, pending: true, error: null } }),
  ),
);
dockConversationReducer.with(dockEvidenceCaptureFailed, (state, { payload: [ws, agent, error] }) =>
  withEvidence(state, ws, agent, (e) =>
    patchDockEvidence(e, { capture: { ...e.capture, pending: false, error } }),
  ),
);
dockConversationReducer.with(dockEvidenceImageCaptured, (state, { payload: [ws, agent, image] }) =>
  withEvidence(state, ws, agent, (e) => {
    const result = applyDockCapture(e, image);
    return patchDockEvidence(result.evidence, {
      capture: {
        pending: false,
        error: result.outcome === 'limit' ? 'limit' : null,
        accepted:
          result.outcome === 'added' || result.outcome === 'replaced'
            ? e.capture.accepted + 1
            : e.capture.accepted,
      },
    });
  }),
);
dockConversationReducer.with(dockEvidenceImageRemoved, (state, { payload: [ws, agent, imageId] }) =>
  withEvidence(state, ws, agent, (e) => removeDockImage(e, imageId)),
);
/** A known missing Accessibility grant outlives its session until a pick works or Settings opens. */
const isPickPermission = (issue: DockAnnotationIssue | null | undefined) =>
  issue?.kind === 'pick' && issue.error === 'permission';

dockConversationReducer.with(
  dockEvidenceAnnotationUndone,
  (state, { payload: [ws, agent, parked] }) =>
    withEvidence(state, ws, agent, (e) => undoDockAnnotationMark(e, parked ?? undefined)),
);
dockConversationReducer.with(dockEvidenceAnnotationRedone, (state, { payload: [ws, agent] }) =>
  withEvidence(state, ws, agent, redoDockAnnotationMark),
);
dockConversationReducer.with(dockEvidenceMarkAdded, (state, { payload: [ws, agent, mark] }) =>
  withEvidence(state, ws, agent, (e) => {
    const added = addDockMark(e, mark).evidence;
    // A new mark starts a new future: nothing undone before it can be redone.
    const next =
      added !== e && added.annotationHistory
        ? patchDockEvidence(added, { annotationHistory: null })
        : added;
    return mark.tool === 'pick' &&
      isPickPermission(next.annotationIssue) &&
      next.marks.some((row) => row.id === mark.id)
      ? patchDockEvidence(next, { annotationIssue: null })
      : next;
  }),
);
/**
 * Opening the pane is the person's fix: the next click tries again (and re-reports a
 * still-missing grant) instead of reopening Settings or staying disabled until the
 * dock reopens.
 */
function afterSettingsOpened(
  state: DockConversationState,
  ws: string,
  agent: string,
  pane: DockEvidencePrivacyPane,
): DockConversationState {
  if (pane === 'microphone' || pane === 'speech') {
    const speech = state.nativeSpeech;
    if (speech.pairId !== dockEvidenceId(ws, agent) || speech.activeId) return state;
    const error = speech.error?.includes('permission') ? null : speech.error;
    let capability = speech.capability;
    if (capability && !capability.available && capability.reason?.includes('permission')) {
      const { reason: _reason, ...rest } = capability;
      capability = { ...rest, available: true };
    }
    return error === speech.error && capability === speech.capability
      ? state
      : { ...state, nativeSpeech: { ...speech, error, capability } };
  }
  return withEvidence(state, ws, agent, (e) => {
    if (pane === 'accessibility' && isPickPermission(e.annotationIssue))
      return patchDockEvidence(e, { annotationIssue: null });
    if (pane === 'screen' && e.capture.error === 'permission')
      return patchDockEvidence(e, { capture: { ...e.capture, error: null } });
    return e;
  });
}
dockConversationReducer.with(
  dockEvidenceOpenSettingsRequested,
  (state, { payload: [ws, agent, pane] }) => afterSettingsOpened(state, ws, agent, pane),
);
dockConversationReducer.with(dockEvidenceMarkRemoved, (state, { payload: [ws, agent, markId] }) =>
  withEvidence(state, ws, agent, (e) => removeDockMark(e, markId)),
);
dockConversationReducer.with(
  dockEvidenceReferencesEdited,
  (state, { payload: [ws, agent, edit] }) =>
    withEvidence(state, ws, agent, (e) => applyDockReferenceEdit(e, edit)),
);
dockConversationReducer.with(dockEvidenceMarkUndone, (state, { payload: [ws, agent] }) =>
  withEvidence(state, ws, agent, undoDockMark),
);
dockConversationReducer.with(dockEvidenceMarkRejected, (state, { payload: [ws, agent, markId] }) =>
  withEvidence(state, ws, agent, (e) => rejectDockMark(e, markId)),
);
dockConversationReducer.with(
  dockEvidenceInsertionQueued,
  (state, { payload: [ws, agent, insertion] }) =>
    withEvidence(state, ws, agent, (e) => enqueueDockInsertion(e, insertion)),
);
dockConversationReducer.with(dockEvidenceToolSet, (state, { payload: [ws, tool] }) =>
  state.toolByWorkspace[ws] === tool
    ? state
    : { ...state, toolByWorkspace: { ...state.toolByWorkspace, [ws]: tool } },
);
dockConversationReducer.with(dockEvidenceToolRemembered, (state, { payload: [ws, tool] }) =>
  state.rememberedToolByWorkspace[ws] === tool
    ? state
    : {
        ...state,
        rememberedToolByWorkspace: { ...state.rememberedToolByWorkspace, [ws]: tool },
      },
);
dockConversationReducer.with(
  dockEvidenceAnnotationChanged,
  (state, { payload: [ws, agent, annotation] }) =>
    withEvidence(state, ws, agent, (e) =>
      patchDockEvidence(e, {
        annotation,
        // Undo history belongs to one session and its image: a new session, a
        // new image or Done (the image is attached) ends it.
        annotationHistory: null,
        // An issue belongs to its session: a different session starts without it,
        // except a missing Accessibility grant, which still blocks picking.
        ...(e.annotationIssue &&
        annotation &&
        annotation.id !== e.annotationIssue.sessionId &&
        !isPickPermission(e.annotationIssue)
          ? { annotationIssue: null }
          : {}),
      }),
    ),
);
dockConversationReducer.with(
  dockEvidenceAnnotationIssue,
  (state, { payload: [ws, agent, issue] }) =>
    withEvidence(state, ws, agent, (e) =>
      (e.annotationIssue ?? null) === issue ? e : patchDockEvidence(e, { annotationIssue: issue }),
    ),
);
dockConversationReducer.with(
  dockEvidenceDictationChanged,
  (state, { payload: [ws, agent, dictation] }) =>
    withEvidence(state, ws, agent, (e) => patchDockEvidence(e, { dictation })),
);
dockConversationReducer.with(
  dockEvidenceDictationFinished,
  (state, { payload: [ws, agent, dictationId, insertion] }) =>
    withEvidence(state, ws, agent, (e) => {
      if (e.dictation?.id !== dictationId) return e;
      const ended = patchDockEvidence(e, { dictation: null });
      return insertion ? enqueueDockInsertion(ended, insertion) : ended;
    }),
);
dockConversationReducer.with(
  dockEvidenceClipChanged,
  (state, { payload: [ws, agent, clipId, clip] }) =>
    withEvidence(state, ws, agent, (e) => setDockClip(e, clipId, clip)),
);
dockConversationReducer.with(dockEvidenceCleared, (state, { payload: [ws, agent, fingerprint] }) =>
  withEvidence(state, ws, agent, (e) =>
    dockEvidenceFingerprint(e) === fingerprint && !isEmpty(e)
      ? {
          ...emptyDockEvidence(e.id),
          annotation: e.annotation && { ...e.annotation, imageId: null },
          dictation: e.dictation,
          // Speech queued from the session that was sent is dropped: the sent message
          // already carries it, and it must never refill the emptied box. Only a
          // dictation started since keeps its pending words (without sent chips).
          insertions: e.insertions
            .filter((row) => !!e.dictation && row.id.startsWith(`${e.dictation.id}:`))
            .map((row) => ({ ...row, parts: row.parts.filter((part) => part.kind === 'text') }))
            .filter((row) => row.parts.length > 0),
          revision: e.revision + 1,
        }
      : e,
  ),
);
dockConversationReducer.with(dockEvidenceRestored, (state, { payload: [ws, agent, restored] }) =>
  withEvidence(state, ws, agent, (e) =>
    isEmpty(e) && restored.id === e.id && !isEmpty(restored)
      ? {
          ...restored,
          annotation: e.annotation,
          dictation: e.dictation,
          insertions: [],
          revision: e.revision + 1,
        }
      : e,
  ),
);
dockConversationReducer.with(
  dockEvidenceInsertionCommitted,
  (state, { payload: [ws, agent, insertionId, committedText, expectedDraftRevision] }) => {
    const evidence = getItem(state.evidence, dockEvidenceId(ws, agent));
    const draft = draftFor(state, ws, agent);
    if (
      !evidence ||
      // Only an editor-ready head commits; one naming an in-flight gesture waits.
      readyDockInsertions(evidence)[0]?.id !== insertionId ||
      draft.revision !== expectedDraftRevision ||
      typeof committedText !== 'string'
    )
      return state;
    return {
      ...state,
      drafts: upsertItem(state.drafts, {
        ...draft,
        text: committedText,
        revision: draft.revision + 1,
      }),
      evidence: upsertItem(state.evidence, ackDockInsertion(evidence, insertionId)),
      sendError: null,
    };
  },
);
dockConversationReducer.with(
  dockEvidenceDictationInterim,
  (state, { payload: [ws, agent, dictationId, parts] }) =>
    withEvidence(state, ws, agent, (e) =>
      e.dictation?.id === dictationId
        ? patchDockEvidence(e, {
            dictation: { ...e.dictation, interim: boundDockInterim(e, parts) },
          })
        : e,
    ),
);
dockConversationReducer.with(
  dockEvidenceCapabilitiesChanged,
  (state, { payload: [capabilities] }) => ({
    ...state,
    nativeCapabilities: capabilities ? { ...capabilities } : null,
  }),
);
dockConversationReducer.with(
  dockEvidencePlacementRecorded,
  (state, { payload: [ws, agent, record] }) =>
    withEvidence(state, ws, agent, (e) =>
      e.images.some((image) => image.id === record.imageId)
        ? patchDockEvidence(e, { placements: { ...e.placements, [record.imageId]: record } })
        : e,
    ),
);
dockConversationReducer.with(
  dockEvidenceServerCapabilitiesObserved,
  (state, { payload: [capabilities] }) => ({
    ...state,
    serverCapabilities: {
      backendId: capabilities.backendId,
      generation: capabilities.generation,
      rawRetention: capabilities.rawRetention === true,
      chiefAttachments: capabilities.chiefAttachments === true,
    },
  }),
);
