import {
  captureDockPlacementBinding,
  isDockBindingCurrent,
  placeDockMediaImage,
} from '$features/hud/composer/dock-evidence-placement';
import { dockMediaCapturedMarks, dockMediaCaptureBatches } from '$shared/dock-media-source';
import { DockMediaSourceSchema } from '$shared/dock-media-edit';
import type { DockCaptureEditorOpenRequest } from '$shared/dock-capture-editor';
import { buffers, channel, type Channel } from 'redux-saga';
import {
  actionChannel,
  call,
  delay,
  fork,
  put,
  race,
  take,
  type SagaGenerator,
} from 'typed-redux-saga';
import { z } from 'zod';
import { Logger } from '$shared/logger';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import { currentDockServerCapabilities } from '../dock-conversation-selectors';
import { store } from '$store/renderer/store';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { serializeDraftAttachments } from '$lib/components/chat/chat-draft-attachments';
import { selectComposerContextItems } from '../../transient-ui/transient-ui-selectors';
import { getPrincipalActionContext } from '../../principal/principal-context';
import type { DockSavedMedia } from '$shared/dock-media-edit';
import { setComposerContextItems } from '../../transient-ui/transient-ui-slice';
import {
  recordingDockClip,
  toDockDraftEvidence,
  type DockCapturedPixels,
  type DockNativeResult,
} from '$shared/dock-evidence';
import { applyDockMediaSave, DockMediaSaveRequestSchema } from '$shared/dock-media-edit';
import {
  DOCK_CAPTURE_EDITOR_CHANNELS,
  DockCaptureEditorDeleteRequestSchema,
  type DockCaptureEditorDeleteRequest,
  type DockCaptureEditorDeleteResult,
  type DockCaptureEditorOpenResult,
  type DockCaptureEditorRetakeResult,
  type DockCaptureEditorSaveResult,
} from '$shared/dock-capture-editor';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { takeEveryByContextFIFO } from '../../../utils/context-saga-effects';
import {
  chatDraftOwnerOpened,
  chatDraftOwnerReleased,
  chatDraftSaveScheduled,
  chatDraftSavePairFlushRequested,
  chatDraftSaveSettled,
} from '../../chat-drafts/chat-drafts-slice';
import {
  dockMediaEditorOpenRequested,
  dockMediaEditSaveRequested,
  dockMediaEditSaveSettled,
  dockEvidenceMediaChanged,
  dockEvidenceImageRemoveRequested,
  dockEvidenceClipRemoveRequested,
  dockEvidenceImageRemoved,
  dockEvidenceClipChanged,
} from '../dock-conversation-slice';
import { endDockEditorHold } from './dock-editor-hold';
import { evidenceOf, dockMediaNativeService } from './dock-evidence-saga';
import { dockInputLive } from './dock-live-input';
import { dockCloseRequested, dockFocusRequested } from '../../hud/hud-slice';
import {
  dockConversationLoaded,
  openDockConversationRequested,
  selectDockConversationAgentRequested,
} from '../dock-conversation-slice';

const requestSchema = z
  .object({
    requestId: z.string().uuid(),
    request: DockMediaSaveRequestSchema,
  })
  .strict();
type SaveAction = ReturnType<typeof dockMediaEditSaveRequested>;

/** Synchronous state handoff; the durable writer receives one combined snapshot. */
function replaceMediaState(
  workspaceId: string,
  agentId: string,
  logicalId: string,
  previous: DockSavedMedia,
  next: DockSavedMedia,
): boolean {
  const evidence = evidenceOf(workspaceId, agentId);
  const row = [...(evidence?.images ?? []), ...(evidence?.clips ?? [])].find(
    (item) => item.id === logicalId,
  );
  const items = selectComposerContextItems.select(store.state, workspaceId, agentId);
  const item = items.find((item) => item.id === row?.contextItemId);
  if (
    !row ||
    !item ||
    JSON.stringify(row.media) !== JSON.stringify(previous) ||
    item.attachmentId !== previous.source.attachmentId ||
    item.path !== previous.source.path
  )
    return false;
  // No await/yield or external input occurs between these synchronous dispatches.
  store.dispatch(dockEvidenceMediaChanged(workspaceId, agentId, logicalId, previous, next));
  if (previous.source.id !== next.source.id || previous.source.path !== next.source.path) {
    store.dispatch(
      setComposerContextItems(
        workspaceId,
        agentId,
        items.map((entry) => {
          if (entry.id !== item.id) return entry;
          const {
            imageData: _pixels,
            imageMimeType: _mime,
            attachmentSize: _size,
            ...rest
          } = entry;
          return {
            ...rest,
            attachmentId: next.source.attachmentId,
            path: next.source.path,
            placementStatus: 'placed' as const,
          };
        }),
      ),
    );
  }
  return true;
}

function* persist({ payload: [requestId, request, authority] }: SaveAction): SagaGenerator<void> {
  const { workspaceId, agentId } = request.pair;
  const result = (value: Omit<DockCaptureEditorSaveResult, 'requestId'>) =>
    dockMediaEditSaveSettled(requestId, { requestId, ...value });
  const current = () => authority === getPrincipalActionContext(store.state);
  const evidence = evidenceOf(workspaceId, agentId);
  const row = [...(evidence?.images ?? []), ...(evidence?.clips ?? [])].find(
    (item) => item.media?.source.id === request.sourceId,
  );
  const previous = row?.media;
  const draft = getItem(
    store.state.dockConversation.drafts,
    JSON.stringify([workspaceId, agentId]),
  );
  if (!current() || !row || !previous || !draft?.restored) {
    yield* put(result({ result: 'stale-source' }));
    return;
  }
  const applied = applyDockMediaSave(previous, request);
  if (applied.status !== 'saved') {
    yield* put(result({ result: applied.status === 'invalid-edit' ? 'failed' : applied.status }));
    return;
  }
  const ownerId = `dock-media-edit:${requestId}`;
  // Subscribe before flushing; a synchronous transport may settle in the same turn.
  const settled = yield* actionChannel(
    (action: ReturnType<typeof chatDraftSaveSettled>) =>
      action.type === chatDraftSaveSettled.type &&
      action.payload[0] === ownerId &&
      action.payload[1] === requestId,
    buffers.expanding(),
  );
  const items = selectComposerContextItems.select(store.state, workspaceId, agentId);
  const rollback = {
    text: draft.text,
    attachments: serializeDraftAttachments(items, toDockDraftEvidence(evidence)),
  };
  try {
    yield* put(chatDraftOwnerOpened(ownerId));
    if (!replaceMediaState(workspaceId, agentId, row.id, previous, applied.media)) {
      yield* put(result({ result: 'stale-source' }));
      return;
    }
    const after = evidenceOf(workspaceId, agentId);
    const actual = [...(after?.images ?? []), ...(after?.clips ?? [])].find(
      (item) => item.id === row.id,
    )?.media;
    if (!current() || JSON.stringify(actual) !== JSON.stringify(applied.media)) {
      yield* put(result({ result: 'stale-source' }));
      return;
    }
    yield* put(
      chatDraftSaveScheduled(ownerId, requestId, {
        workspaceId,
        agentId,
        authority,
        text: draft.text,
        attachments: serializeDraftAttachments(
          selectComposerContextItems.select(store.state, workspaceId, agentId),
          toDockDraftEvidence(after),
        ),
        rollback,
      }),
    );
    yield* put(chatDraftSavePairFlushRequested(workspaceId, agentId));
    const { written } = yield* race({ written: take(settled), expired: delay(14_000) });
    if (!written) {
      // The daemon may still commit. Do not pretend timeout cancelled that write
      // or restore an older revision over it; reopening reconciles the revision.
      yield* put(result({ result: 'failed' }));
      return;
    }
    if (written.payload[2] !== 'saved') {
      // A later typing/evidence save may already include this edit. Only roll
      // back the exact unmodified snapshot that this failed write owned.
      const liveDraft = getItem(
        store.state.dockConversation.drafts,
        JSON.stringify([workspaceId, agentId]),
      );
      const unchanged =
        liveDraft?.revision === draft.revision &&
        evidenceOf(workspaceId, agentId)?.revision === after?.revision;
      if (current() && unchanged)
        replaceMediaState(workspaceId, agentId, row.id, applied.media, previous);
      yield* put(result({ result: 'failed' }));
      return;
    }
    yield* put(
      result(
        current() ? { result: 'saved', saved: applied.media.saved! } : { result: 'stale-source' },
      ),
    );
  } catch {
    yield* put(result({ result: 'failed' }));
  } finally {
    settled.close();
    yield* put(chatDraftOwnerReleased(ownerId));
  }
}

/** Re-read both ownership halves after every durable wait. */
function publishedMediaItem(
  workspaceId: string,
  agentId: string,
  logicalId: string,
  expected: DockSavedMedia,
  contextItemId?: string,
) {
  const evidence = evidenceOf(workspaceId, agentId);
  const row = [...(evidence?.images ?? []), ...(evidence?.clips ?? [])].find(
    (entry) => entry.id === logicalId,
  );
  if (
    !row ||
    row.mediaError ||
    row.contextItemId !== contextItemId ||
    JSON.stringify(row.media) !== JSON.stringify(expected)
  )
    return null;
  const item = selectComposerContextItems
    .select(store.state, workspaceId, agentId)
    .find((entry) => entry.id === contextItemId);
  return item?.attachmentId === expected.source.attachmentId && item.path === expected.source.path
    ? item
    : null;
}

function* analyzeAndPublish(
  workspaceId: string,
  agentId: string,
  logicalId: string,
  authority: string,
): SagaGenerator<void> {
  const service = dockMediaNativeService();
  const row = evidenceOf(workspaceId, agentId)?.clips.find((entry) => entry.id === logicalId);
  const initial = row?.media;
  if (!initial || !service?.analyzeMedia || initial.source.audio !== 'available') return;
  const jobId = crypto.randomUUID();
  try {
    const result = yield* call(() => service.analyzeMedia!({ jobId, media: initial }));
    if (
      !result.ok ||
      authority !== getPrincipalActionContext(store.state) ||
      service !== dockMediaNativeService()
    )
      return;
    const live = evidenceOf(workspaceId, agentId)?.clips.find(
      (entry) => entry.id === logicalId,
    )?.media;
    if (
      !live ||
      JSON.stringify(live.source) !== JSON.stringify(initial.source) ||
      !publishedMediaItem(workspaceId, agentId, logicalId, live, row?.contextItemId) ||
      result.value.sourceId !== live.source.id ||
      result.value.sourceRevision !== live.source.revision
    )
      return;
    yield* call(() =>
      window.electronAPI.invoke(DOCK_CAPTURE_EDITOR_CHANNELS.WAVEFORM_UPDATE, {
        pair: { workspaceId, agentId },
        sourceId: live.source.id,
        sourceRevision: live.source.revision,
        waveform: result.value,
      }),
    );
  } catch {
    /* Missing/failed audio is left unavailable; never draw invented peaks. */
  } finally {
    yield* call(() => service.releaseMediaJob?.(jobId).catch(() => {}));
  }
}

const recognitionFlights = new Set<{
  key: string;
  service: NonNullable<ReturnType<typeof dockMediaNativeService>>;
  binding: ReturnType<typeof captureDockPlacementBinding>;
}>();

function* recognizeAndPersist(
  workspaceId: string,
  agentId: string,
  logicalId: string,
  authority: string,
  binding: ReturnType<typeof captureDockPlacementBinding>,
): SagaGenerator<void> {
  const service = dockMediaNativeService();
  const initial = evidenceOf(workspaceId, agentId)?.clips.find(
    (row) => row.id === logicalId,
  )?.media;
  if (
    !initial ||
    !service?.transcribeMedia ||
    initial.source.audio === 'none' ||
    initial.transcript?.status === 'ready' ||
    initial.transcript?.status === 'no-speech'
  )
    return;
  const current = () =>
    authority === getPrincipalActionContext(store.state) &&
    service === dockMediaNativeService() &&
    isDockBindingCurrent(binding);
  if (!current()) return;
  const key = JSON.stringify([
    authority,
    workspaceId,
    agentId,
    logicalId,
    binding.backendId,
    binding.generation,
    initial.source,
  ]);
  if (
    [...recognitionFlights].some(
      (flight) =>
        flight.key === key &&
        flight.service === service &&
        flight.binding.transport === binding.transport,
    )
  )
    return;
  const flight = { key, service, binding };
  // Reserve synchronously before the first yield: repeated Edit fronts the same
  // editor while this exact source continues its single background recognition.
  recognitionFlights.add(flight);
  const jobId = crypto.randomUUID();
  try {
    const result = yield* call(() => service.transcribeMedia!({ jobId, media: initial }));
    if (!result.ok || !current()) return;
    const liveRow = evidenceOf(workspaceId, agentId)?.clips.find((row) => row.id === logicalId);
    const live = liveRow?.media;
    if (
      !live ||
      JSON.stringify(live.source) !== JSON.stringify(initial.source) ||
      !publishedMediaItem(workspaceId, agentId, logicalId, live, liveRow?.contextItemId)
    )
      return;
    const transcript = { ...result.value, revision: (live.transcript?.revision ?? 0) + 1 };
    const next = { ...live, transcript };
    if (!replaceMediaState(workspaceId, agentId, logicalId, live, next)) return;
    const ownerId = `dock-media-transcript:${jobId}`,
      requestId = crypto.randomUUID();
    const settled = yield* actionChannel(
      (action: ReturnType<typeof chatDraftSaveSettled>) =>
        action.type === chatDraftSaveSettled.type &&
        action.payload[0] === ownerId &&
        action.payload[1] === requestId,
      buffers.expanding(),
    );
    try {
      const draft = getItem(
        store.state.dockConversation.drafts,
        JSON.stringify([workspaceId, agentId]),
      );
      if (!draft?.restored) return;
      yield* put(chatDraftOwnerOpened(ownerId));
      yield* put(
        chatDraftSaveScheduled(ownerId, requestId, {
          workspaceId,
          agentId,
          authority,
          text: draft.text,
          attachments: serializeDraftAttachments(
            selectComposerContextItems.select(store.state, workspaceId, agentId),
            toDockDraftEvidence(evidenceOf(workspaceId, agentId)),
          ),
          rollback: null,
        }),
      );
      yield* put(chatDraftSavePairFlushRequested(workspaceId, agentId));
      const { written } = yield* race({ written: take(settled), expired: delay(14_000) });
      if (
        written?.payload[2] === 'saved' &&
        current() &&
        publishedMediaItem(workspaceId, agentId, logicalId, next, liveRow?.contextItemId)
      )
        yield* call(() =>
          window.electronAPI.invoke(DOCK_CAPTURE_EDITOR_CHANNELS.TRANSCRIPT_UPDATE, {
            pair: { workspaceId, agentId },
            sourceId: live.source.id,
            sourceRevision: live.source.revision,
            transcript,
          }),
        );
    } finally {
      settled.close();
      yield* put(chatDraftOwnerReleased(ownerId));
    }
  } finally {
    try {
      yield* call(() => service.releaseMediaJob?.(jobId).catch(() => {}));
    } finally {
      recognitionFlights.delete(flight);
    }
  }
}

interface MediaPreparation {
  workspaceId: string;
  agentId: string;
  logicalId: string;
  authority: string;
  binding: ReturnType<typeof captureDockPlacementBinding>;
}

/** The editor opens only after the source metadata has passed the same durable writer. */
/**
 * Open the editor for a capture or a pill. A capture's dock hold goes along with the
 * request (the opened editor adopts it); whenever the editor does not open, it ends here.
 */
function* openEditor(
  action: ReturnType<typeof dockMediaEditorOpenRequested>,
  preparation: Channel<MediaPreparation>,
): SagaGenerator<void> {
  const held = { token: action.payload[4], adopted: false };
  try {
    yield* openEditorWith(action, preparation, held);
  } finally {
    if (!held.adopted) endDockEditorHold(held.token);
  }
}

function* openEditorWith(
  {
    payload: [workspaceId, agentId, logicalId, origin],
  }: ReturnType<typeof dockMediaEditorOpenRequested>,
  preparation: Channel<MediaPreparation>,
  held: { token?: string; adopted: boolean },
): SagaGenerator<void> {
  // Startup phase durations only (no content, paths or ids), for editor-delay reports.
  const phases: Record<string, number> = {};
  const startedAt = performance.now();
  let markedAt = startedAt;
  const mark = (name: string) => {
    const now = performance.now();
    phases[name] = Math.round(now - markedAt);
    markedAt = now;
  };
  const authority = getPrincipalActionContext(store.state),
    binding = captureDockPlacementBinding();
  if (!authority) return;
  // The Assistant workspace keeps capture sources only where the connection advertises
  // it (as for its other attachments): say so instead of trying and failing silently.
  if (
    workspaceId === CHIEF_WORKSPACE_ID &&
    currentDockServerCapabilities(store.state)?.chiefAttachments !== true
  ) {
    const dock = store.state.dockConversation;
    if (dock.workspaceId === workspaceId && dock.agentId === agentId)
      notify.warning(m.dock_captureEditor_assistantUnavailable_error());
    return;
  }
  const current = () =>
    getPrincipalActionContext(store.state) === authority && isDockBindingCurrent(binding);
  /** Same principal and backend, and the conversation that asked is still the one shown. */
  const shownHere = () =>
    current() &&
    store.state.dockConversation.workspaceId === workspaceId &&
    store.state.dockConversation.agentId === agentId;
  let evidence = evidenceOf(workspaceId, agentId);
  let row = [...(evidence?.images ?? []), ...(evidence?.clips ?? [])].find(
    (item) => item.id === logicalId,
  );
  if (!evidence || !row || row.mediaError) return;
  let item = selectComposerContextItems
    .select(store.state, workspaceId, agentId)
    .find((item) => item.id === row!.contextItemId);
  if (!item) return;
  if (!row.media && 'width' in row && item.imageData && item.imageMimeType) {
    const before = JSON.stringify(row),
      pixels = item.imageData,
      mime = item.imageMimeType;
    mark('beforePlace');
    const placed = yield* call(
      placeDockMediaImage,
      workspaceId,
      `capture-original-${crypto.randomUUID()}.png`,
      { data: pixels, mimeType: mime },
      binding,
    );
    if (!current()) return;
    evidence = evidenceOf(workspaceId, agentId);
    const live = evidence?.images.find((entry) => entry.id === logicalId);
    if (!evidence || !live || JSON.stringify(live) !== before) return;
    const source = DockMediaSourceSchema.parse({
      id: crypto.randomUUID(),
      revision: 0,
      kind: 'screenshot',
      attachmentId: placed.attachmentId,
      path: placed.path,
      durationMs: 0,
      width: live.width,
      height: live.height,
      ...(live.capture ? { capture: live.capture } : {}),
      audio: 'none',
      visuals: 'clean',
      batches: dockMediaCaptureBatches([], 0),
    });
    source.capturedMarks = dockMediaCapturedMarks(evidence, source, logicalId);
    const items = selectComposerContextItems.select(store.state, workspaceId, agentId);
    store.dispatch(
      setComposerContextItems(
        workspaceId,
        agentId,
        items.map((entry) =>
          entry.id === item!.id
            ? {
                ...entry,
                attachmentId: source.attachmentId,
                path: source.path,
                attachmentMimeType: placed.mimeType ?? mime,
                attachmentSize: placed.size,
                placementStatus: 'placed' as const,
              }
            : entry,
        ),
      ),
    );
    store.dispatch(
      dockEvidenceMediaChanged(workspaceId, agentId, logicalId, null, {
        source,
        saved: null,
        transcript: null,
      }),
    );
    row = evidenceOf(workspaceId, agentId)?.images.find((entry) => entry.id === logicalId);
    item = selectComposerContextItems
      .select(store.state, workspaceId, agentId)
      .find((entry) => entry.id === item!.id);
  }
  if (!row || !item || !current()) return;
  // Repair historical mic flags from the exact original container, never from
  // an exported Voice Off file or from the annotated writer's append receipt.
  const service = dockMediaNativeService(),
    beforeProbe = row.media;
  if (
    beforeProbe?.source.kind === 'recording' &&
    service?.probeMediaAudio &&
    (beforeProbe.source.audio !== 'available' || beforeProbe.transcript?.error === 'no-audio-track')
  ) {
    const jobId = crypto.randomUUID();
    let probed: Awaited<ReturnType<NonNullable<typeof service.probeMediaAudio>>> | undefined;
    try {
      probed = yield* call(() => service.probeMediaAudio!({ jobId, media: beforeProbe }));
    } catch {
      /* Missing/old helper leaves metadata unchanged; never guess audio. */
    } finally {
      yield* call(() => service.releaseMediaJob?.(jobId).catch(() => {}));
    }
    if (!current() || service !== dockMediaNativeService()) return;
    const liveItem = publishedMediaItem(
      workspaceId,
      agentId,
      logicalId,
      beforeProbe,
      row.contextItemId,
    );
    if (!liveItem || liveItem.id !== item.id) return;
    if (
      probed?.ok &&
      probed.value.sourceId === beforeProbe.source.id &&
      probed.value.sourceRevision === beforeProbe.source.revision
    ) {
      const audio =
        probed.value.populatedTrackCount > 0 ? ('available' as const) : ('none' as const);
      if (audio !== beforeProbe.source.audio) {
        const correctedSource = {
          ...beforeProbe.source,
          audio,
          revision: beforeProbe.source.revision + 1,
        };
        const corrected: DockSavedMedia = {
          ...beforeProbe,
          source: correctedSource,
          ...(beforeProbe.originalSource?.id === beforeProbe.source.id &&
          beforeProbe.originalSource.revision === beforeProbe.source.revision &&
          beforeProbe.originalSource.path === beforeProbe.source.path
            ? { originalSource: correctedSource }
            : {}),
          // Metadata correction does not change the user's saved Video/Voice choice.
          saved: beforeProbe.saved
            ? { ...beforeProbe.saved, sourceRevision: correctedSource.revision }
            : null,
          transcript:
            beforeProbe.transcript?.status === 'ready'
              ? beforeProbe.transcript
              : {
                  status: audio === 'available' ? 'pending' : 'unavailable',
                  revision: (beforeProbe.transcript?.revision ?? 0) + 1,
                  words: [],
                  ...(audio === 'none' ? { error: 'no-audio-track' } : {}),
                },
        };
        if (!replaceMediaState(workspaceId, agentId, logicalId, beforeProbe, corrected)) return;
      }
    }
    row = evidenceOf(workspaceId, agentId)?.clips.find((entry) => entry.id === logicalId);
    item = selectComposerContextItems
      .select(store.state, workspaceId, agentId)
      .find((entry) => entry.id === liveItem.id);
    if (!row || !item || !current()) return;
  }
  // Legacy recordings stay read-only; no guessed dimensions, batches or clean pixels.
  const media = row.media,
    source = media?.source;
  if (!source || !media) return;
  const ownerId = `dock-media-source:${crypto.randomUUID()}`,
    requestId = crypto.randomUUID();
  const settled = yield* actionChannel(
    (action: ReturnType<typeof chatDraftSaveSettled>) =>
      action.type === chatDraftSaveSettled.type &&
      action.payload[0] === ownerId &&
      action.payload[1] === requestId,
    buffers.expanding(),
  );
  try {
    const draft = getItem(
      store.state.dockConversation.drafts,
      JSON.stringify([workspaceId, agentId]),
    );
    if (!draft?.restored) return;
    yield* put(chatDraftOwnerOpened(ownerId));
    yield* put(
      chatDraftSaveScheduled(ownerId, requestId, {
        workspaceId,
        agentId,
        authority,
        text: draft.text,
        attachments: serializeDraftAttachments(
          selectComposerContextItems.select(store.state, workspaceId, agentId),
          toDockDraftEvidence(evidenceOf(workspaceId, agentId)),
        ),
        rollback: null,
      }),
    );
    mark('placeAndPrepare');
    yield* put(chatDraftSavePairFlushRequested(workspaceId, agentId));
    const { written } = yield* race({ written: take(settled), expired: delay(14_000) });
    mark('draftFlushAck');
    if (!written || written.payload[2] !== 'saved' || !current()) return;
    const published = publishedMediaItem(workspaceId, agentId, logicalId, media, row.contextItemId);
    if (!published || published.id !== item.id) return;
    const request: DockCaptureEditorOpenRequest = {
      kind: source.kind,
      workspaceId,
      agentId,
      attachmentId: source.attachmentId,
      sourceRevision: String(source.revision),
      attachmentPath: source.path,
      title: published.label,
      width: source.width,
      height: source.height,
      durationMs: source.durationMs,
      provenance: { hasMicAudio: source.audio === 'available', visuals: source.visuals },
      marks: [],
      source,
      saved: media.saved,
      transcript: media.transcript,
      ...(media.originalSource ? { originalSource: media.originalSource } : {}),
      ...(held.token ? { holdToken: held.token } : {}),
    };
    // The capability may have been withdrawn while the draft was saved: never open then.
    if (
      workspaceId === CHIEF_WORKSPACE_ID &&
      currentDockServerCapabilities(store.state)?.chiefAttachments !== true
    ) {
      if (shownHere()) notify.warning(m.dock_captureEditor_assistantUnavailable_error());
      return;
    }
    const opened = (yield* call(() =>
      window.electronAPI.invoke(DOCK_CAPTURE_EDITOR_CHANNELS.OPEN, request),
    )) as DockCaptureEditorOpenResult | undefined;
    mark('mainOpen');
    startupLogger.info('Capture editor startup', {
      origin: origin ?? 'pill',
      opened: !!opened?.ok,
      totalMs: Math.round(performance.now() - startedAt),
      ...phases,
    });
    // Refused: say so where it was asked, and start no follow-up recognition for it.
    if (!opened?.ok) {
      if (shownHere()) notify.warning(m.dock_captureEditor_openFailed_error());
      return;
    }
    // The opened editor session owns the dock hold now; it ends when the editor does.
    held.adopted = !!held.token;
    // The session this dock opened: only its Attach may return here, and only until a newer
    // editor opens (or the principal/backend changes).
    editorGeneration += 1;
    admittedEditor = {
      openId: opened.openId,
      authority,
      backend: store.state.connections.windowBackendId,
      workspaceId,
      agentId,
      generation: editorGeneration,
    };
    // A new capture's editor takes over: the dock closes behind it, as Escape would,
    // once the editor is open and only for the conversation still shown. Live input
    // (dictation, a recording, an annotate session, the mic) keeps it open.
    if (origin === 'capture' && shownHere() && !dockInputLive()) yield* put(dockCloseRequested());
    // Root-owned background work is outside the per-pair Edit FIFO. Attached
    // forks here would still keep that FIFO call blocked until recognition ends.
    yield* put(preparation, { workspaceId, agentId, logicalId, authority, binding });
  } finally {
    settled.close();
    yield* put(chatDraftOwnerReleased(ownerId));
  }
}

const attachedSchema = z
  .object({
    openId: z.string().uuid(),
    workspaceId: z.string().min(1),
    agentId: z.string().min(1),
    attachmentId: z.string().min(1),
    sourceId: z.string().min(1).nullable(),
    sourceRevision: z.number().int().nonnegative().nullable(),
  })
  .strict();

/**
 * The editor attached (main already brought the dock forward): return to exactly that
 * conversation and put the keyboard in its prompt. Only for the same principal and
 * backend, while this attachment's source is still the one the editor had, and never
 * over live input or a send. Drafts and attachments are untouched.
 */
function* returnAfterAttach(value: z.infer<typeof attachedSchema>): SagaGenerator<void> {
  const { openId, workspaceId, agentId, attachmentId, sourceId, sourceRevision } = value;
  const mine = admittedEditor;
  const myReturn = ++returnGeneration;
  // The attachment still has the source the editor had (not removed, replaced or revised).
  const sourceCurrent = (): boolean => {
    const evidence = evidenceOf(workspaceId, agentId);
    const rows: Array<{
      media?: { source?: { attachmentId: string; id: string; revision: number } };
    }> = [...(evidence?.images ?? []), ...(evidence?.clips ?? [])];
    return rows.some((row) => {
      const source = row.media?.source;
      return (
        !!source &&
        source.attachmentId === attachmentId &&
        (sourceId === null || (source.id === sourceId && source.revision === sourceRevision))
      );
    });
  };

  let answered = false;
  const answer = (accept: boolean) =>
    call(() =>
      window.electronAPI
        .invoke(DOCK_CAPTURE_EDITOR_CHANNELS.ATTACH_RETURN, { openId, accept })
        .then((ok: unknown) => ok === true)
        .catch(() => false),
    );
  // Still this dock's own session, principal and backend; the attachment's source the one
  // the editor had; no newer editor or return; no live input or send.
  const current = (): boolean => {
    if (!mine || mine.openId !== openId || mine.generation !== editorGeneration) return false;
    if (myReturn !== returnGeneration) return false;
    if (mine.workspaceId !== workspaceId || mine.agentId !== agentId) return false;
    if (getPrincipalActionContext(store.state) !== mine.authority) return false;
    if (store.state.connections.windowBackendId !== mine.backend) return false;
    if (dockInputLive() || store.state.dockConversation.sending) return false;
    return sourceCurrent();
  };
  try {
    if (!current()) return;
    answered = true;
    // Main releases the hold and brings this dock forward only now, after validation.
    if (!(yield* answer(true)) || !current()) return;
    admittedEditor = null;
    const keep = mine!;
    const still = (): boolean =>
      myReturn === returnGeneration &&
      keep.generation === editorGeneration &&
      getPrincipalActionContext(store.state) === keep.authority &&
      store.state.connections.windowBackendId === keep.backend &&
      !dockInputLive() &&
      !store.state.dockConversation.sending &&
      sourceCurrent();
    // The dock opens by keyboard first, so the conversation mounts asked to focus its prompt.
    yield* put(dockFocusRequested());
    if (store.state.dockConversation.workspaceId !== workspaceId)
      yield* put(openDockConversationRequested(workspaceId));
    let selected = false;
    for (let waited = 0; waited < 10_000; waited += 100) {
      const dock = store.state.dockConversation;
      if (!still() || dock.workspaceId !== workspaceId || dock.error) return;
      if (!dock.loading && dock.agentId) {
        if (dock.agentId !== agentId) {
          if (selected) return;
          selected = true;
          yield* put(selectDockConversationAgentRequested(agentId));
        } else {
          if (dock.authority === keep.authority) yield* put(dockFocusRequested());
          return;
        }
      }
      yield* race({ loaded: take(dockConversationLoaded), tick: delay(100) });
    }
  } finally {
    // Every attach is answered: an invalid or superseded one refuses (main reveals as a close).
    if (!answered) yield* answer(false);
  }
}

const startupLogger = new Logger('DockEditorStartup');

/** The editor session this dock opened last (see openEditorWith), and its generation. */
let admittedEditor: {
  openId: string;
  authority: string;
  backend: string | null;
  workspaceId: string;
  agentId: string;
  generation: number;
} | null = null;
let editorGeneration = 0;
/** Bumped by each Attach received: an older return stops at its next check. */
let returnGeneration = 0;

const retakeSchema = z
  .object({
    requestId: z.string().uuid(),
    pair: z.object({ workspaceId: z.string().min(1), agentId: z.string().min(1) }).strict(),
    expected: z
      .object({ sourceId: z.string().min(1), sourceRevision: z.number().int().nonnegative() })
      .strict(),
  })
  .strict();

/**
 * Retake (screenshot editor): capture again in the source's own mode and place the
 * pixels as a new, immutable file; reply with that candidate's canonical source. The
 * draft, its attachment and its evidence do not change here: Save swaps the candidate
 * in (applyDockMediaSave), and an abandoned candidate is only an unused file. A
 * capture without a verified frame on the source's display cannot carry the marks
 * over, so it is refused before anything is placed. Exactly one reply per request.
 */
function* retakeCapture(request: z.infer<typeof retakeSchema>): SagaGenerator<void> {
  const {
    requestId,
    pair: { workspaceId, agentId },
    expected,
  } = request;
  const authority = getPrincipalActionContext(store.state),
    binding = captureDockPlacementBinding();
  const service = dockMediaNativeService();
  const current = () =>
    !!authority &&
    authority === getPrincipalActionContext(store.state) &&
    isDockBindingCurrent(binding) &&
    service === dockMediaNativeService();
  // The session's source must still be this pair's, unchanged, at every step.
  const sourceNow = () =>
    evidenceOf(workspaceId, agentId)?.images.find(
      (row) =>
        row.media?.source.id === expected.sourceId &&
        row.media.source.revision === expected.sourceRevision,
    )?.media?.source ?? null;
  let reply: DockCaptureEditorRetakeResult = { requestId, ok: false, error: 'failed' };
  try {
    const evidence = evidenceOf(workspaceId, agentId),
      original = sourceNow();
    const mode = original?.capture?.mode,
      frame = original?.capture?.frame;
    // One capture at a time, and never while a recording or annotate session holds the screen.
    if (
      !current() ||
      !service ||
      !evidence ||
      !original ||
      original.kind !== 'screenshot' ||
      !mode ||
      !frame ||
      evidence.capture.pending ||
      evidence.annotation ||
      recordingDockClip(evidence)
    )
      return;
    let result: DockNativeResult<DockCapturedPixels>;
    try {
      result = yield* call([service, service.captureDisplay], mode);
    } catch {
      return;
    }
    if (!current()) return;
    if (!result.ok) {
      reply = {
        requestId,
        ok: false,
        error:
          result.detail === 'cancelled'
            ? 'cancelled'
            : result.error === 'permission'
              ? 'permission'
              : 'failed',
      };
      return;
    }
    const pixels = result.value,
      taken = pixels.capture;
    if (
      taken?.mode !== mode ||
      !taken.frame ||
      taken.frame.displayId !== frame.displayId ||
      !sourceNow()
    )
      return;
    const extension = pixels.mimeType.split('/')[1] ?? 'png';
    const placed = yield* call(
      placeDockMediaImage,
      workspaceId,
      `capture-retake-${crypto.randomUUID()}.${extension}`,
      { data: pixels.base64, mimeType: pixels.mimeType },
      binding,
    );
    if (!current() || !sourceNow()) return;
    const source = DockMediaSourceSchema.safeParse({
      id: crypto.randomUUID(),
      revision: 0,
      kind: 'screenshot',
      attachmentId: placed.attachmentId,
      path: placed.path,
      durationMs: 0,
      width: pixels.width,
      height: pixels.height,
      capture: taken,
      audio: 'none',
      visuals: 'clean',
      batches: dockMediaCaptureBatches([], 0),
    });
    if (source.success) reply = { requestId, ok: true, source: source.data };
  } catch {
    /* Placement failed or the backend changed: the reply stays failed. */
  } finally {
    try {
      yield* call(() =>
        window.electronAPI.invoke(DOCK_CAPTURE_EDITOR_CHANNELS.RETAKE_RESULT, reply),
      );
    } catch {
      /* A retired main cannot receive it; its own timeout brings the editor back. */
    }
  }
}

/** Remove through the same logical-id path as the Dock, never by a supplied file path. */
export function* deleteEditorCapture(request: DockCaptureEditorDeleteRequest): SagaGenerator<void> {
  const { workspaceId, agentId } = request.pair;
  let outcome: DockCaptureEditorDeleteResult['result'] = 'stale-source';
  const authority = getPrincipalActionContext(store.state);
  const binding = captureDockPlacementBinding();
  const current = () =>
    !!authority &&
    getPrincipalActionContext(store.state) === authority &&
    isDockBindingCurrent(binding) &&
    store.state.dockConversation.workspaceId === workspaceId &&
    store.state.dockConversation.agentId === agentId;
  try {
    if (!current()) return;
    const evidence = evidenceOf(workspaceId, agentId);
    const rows = request.kind === 'screenshot' ? (evidence?.images ?? []) : (evidence?.clips ?? []);
    const items = selectComposerContextItems.select(store.state, workspaceId, agentId);
    const matches = rows.filter((row) => {
      const item = items.find((entry) => entry.id === row.contextItemId);
      if (!item || item.attachmentId !== request.attachmentId) return false;
      const media = row.media;
      // A canonical source cannot be downgraded to a legacy file-only request.
      if (!media)
        return (
          request.sourceId === undefined &&
          request.sourceRevision === undefined &&
          request.expectedEditRevision === undefined
        );
      return (
        media.source.kind === request.kind &&
        media.source.id === request.sourceId &&
        media.source.revision === request.sourceRevision &&
        media.source.attachmentId === request.attachmentId &&
        item.path === media.source.path &&
        (media.saved?.revision ?? 0) === request.expectedEditRevision
      );
    });
    if (matches.length !== 1) return;
    const row = matches[0];
    // Subscribe before dispatch: the canonical removal may complete synchronously.
    const changed = yield* actionChannel(
      (action: { type: string; payload?: unknown[] }) =>
        action.type === dockEvidenceImageRemoved.type ||
        action.type === dockEvidenceClipChanged.type ||
        action.type === setComposerContextItems.type,
      buffers.sliding(1),
    );
    try {
      if (!current()) return;
      yield* put(
        request.kind === 'screenshot'
          ? dockEvidenceImageRemoveRequested(workspaceId, agentId, row.id)
          : dockEvidenceClipRemoveRequested(workspaceId, agentId, row.id),
      );
      const removed = () => {
        const after = evidenceOf(workspaceId, agentId);
        return (
          ![...(after?.images ?? []), ...(after?.clips ?? [])].some(
            (entry) => entry.id === row.id,
          ) &&
          !selectComposerContextItems
            .select(store.state, workspaceId, agentId)
            .some((entry) => entry.id === row.contextItemId)
        );
      };
      // Native temp-file cleanup can finish later. Only the draft removal is acknowledged.
      while (current() && !removed()) {
        const { timedOut } = yield* race({ changed: take(changed), timedOut: delay(1500) });
        if (timedOut) {
          outcome = 'failed';
          return;
        }
      }
      if (current() && removed()) outcome = 'deleted';
    } finally {
      changed.close();
    }
  } finally {
    try {
      yield* call(() =>
        window.electronAPI.invoke(DOCK_CAPTURE_EDITOR_CHANNELS.DELETE_RESULT, {
          requestId: request.requestId,
          result: outcome,
        } satisfies DockCaptureEditorDeleteResult),
      );
    } catch {
      /* A retired owner is never retried into another editor. */
    }
  }
}

/** Sole dock listener; the editor and main have separate, strictly bound ends. */
export function* dockMediaEditSaga(): SagaGenerator<void> {
  const preparation = channel<MediaPreparation>(buffers.expanding());
  yield* fork(function* prepareOpenedMedia(): SagaGenerator<void> {
    while (true) {
      const request = yield* take(preparation);
      yield* fork(
        analyzeAndPublish,
        request.workspaceId,
        request.agentId,
        request.logicalId,
        request.authority,
      );
      yield* fork(function* recognizeOpenedMedia(): SagaGenerator<void> {
        try {
          yield* recognizeAndPersist(
            request.workspaceId,
            request.agentId,
            request.logicalId,
            request.authority,
            request.binding,
          );
        } catch {
          /* A retired/failed request must not cancel the root-owned worker. */
        }
      });
    }
  });
  const completed = yield* actionChannel(dockMediaEditSaveSettled, buffers.expanding());
  yield* takeEveryByContextFIFO(
    dockMediaEditorOpenRequested,
    ({ payload: [workspaceId, agentId] }: ReturnType<typeof dockMediaEditorOpenRequested>) =>
      JSON.stringify([workspaceId, agentId]),
    function* (action) {
      const [workspaceId, agentId] = action.payload;
      const authority = getPrincipalActionContext(store.state),
        binding = captureDockPlacementBinding();
      try {
        yield* openEditor(action, preparation);
      } catch {
        // Source/placement errors keep the current draft. Only the conversation that asked,
        // still shown under the same principal and backend, is told; a stale request is not.
        const dock = store.state.dockConversation;
        if (
          getPrincipalActionContext(store.state) === authority &&
          isDockBindingCurrent(binding) &&
          dock.workspaceId === workspaceId &&
          dock.agentId === agentId
        )
          notify.warning(m.dock_captureEditor_openFailed_error());
      }
    },
    {},
  );
  yield* takeEveryByContextFIFO(
    dockMediaEditSaveRequested,
    ({ payload: [, request, authority] }: SaveAction) => JSON.stringify([authority, request.pair]),
    persist,
    {},
  );
  yield* takeEveryFromElectronChannel<object>(
    DOCK_CAPTURE_EDITOR_CHANNELS.SAVE_REQUESTED,
    function* (value) {
      const parsed = requestSchema.safeParse(value);
      const authority = getPrincipalActionContext(store.state);
      if (parsed.success && authority)
        yield* put(
          dockMediaEditSaveRequested(parsed.data.requestId, parsed.data.request, authority),
        );
    },
    {
      bufferPolicy: {
        kind: 'lossless',
        rationale: 'Each editor save requires a correlated durable result.',
      },
    },
  );
  yield* takeEveryFromElectronChannel<object>(
    DOCK_CAPTURE_EDITOR_CHANNELS.DELETE_REQUESTED,
    function* (value) {
      const parsed = DockCaptureEditorDeleteRequestSchema.safeParse(value);
      if (parsed.success) yield* deleteEditorCapture(parsed.data);
    },
    {
      bufferPolicy: {
        kind: 'lossless',
        rationale: 'Each bound removal requires a correlated result.',
      },
    },
  );
  yield* takeEveryFromElectronChannel<object>(
    DOCK_CAPTURE_EDITOR_CHANNELS.ATTACHED,
    function* (value) {
      const parsed = attachedSchema.safeParse(value);
      if (parsed.success) yield* returnAfterAttach(parsed.data);
    },
    {
      bufferPolicy: {
        kind: 'sliding',
        limit: 1,
        rationale: 'Only the newest attach decides where the dock returns.',
      },
    },
  );
  yield* takeEveryFromElectronChannel<object>(
    DOCK_CAPTURE_EDITOR_CHANNELS.RETAKE_REQUESTED,
    function* (value) {
      const parsed = retakeSchema.safeParse(value);
      if (parsed.success) yield* retakeCapture(parsed.data);
    },
    {
      bufferPolicy: {
        kind: 'lossless',
        rationale: 'Each retake request requires exactly one correlated result.',
      },
    },
  );
  try {
    while (true) {
      const {
        payload: [, response],
      } = yield* take(completed);
      try {
        yield* call(() =>
          window.electronAPI.invoke(DOCK_CAPTURE_EDITOR_CHANNELS.SAVE_RESULT, response),
        );
      } catch {
        // A retired main/document cannot receive this acknowledgement. Never
        // retry it into a different editor session or claim its write cancelled.
      }
    }
  } finally {
    preparation.close();
    completed.close();
  }
}
