import { captureDockPlacementBinding, isDockBindingCurrent, placeDockMediaImage } from '$features/hud/composer/dock-evidence-placement';
import { dockMediaCapturedMarks, dockMediaCaptureBatches } from '$shared/dock-media-source';
import { DockMediaSourceSchema } from '$shared/dock-media-edit';
import type { DockCaptureEditorOpenRequest } from '$shared/dock-capture-editor';
import { buffers } from 'redux-saga';
import {
  actionChannel,
  call,
  delay,
  put,
  race,
  take,
  type SagaGenerator,
} from 'typed-redux-saga';
import { z } from 'zod';
import { store } from '$store/renderer/store';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { serializeDraftAttachments } from '$lib/components/chat/chat-draft-attachments';
import { selectComposerContextItems } from '../../transient-ui/transient-ui-selectors';
import { getPrincipalActionContext } from '../../principal/principal-context';
import type { DockSavedMedia } from '$shared/dock-media-edit';
import { setComposerContextItems } from '../../transient-ui/transient-ui-slice';
import { toDockDraftEvidence } from '$shared/dock-evidence';
import { applyDockMediaSave, DockMediaSaveRequestSchema } from '$shared/dock-media-edit';
import {
  DOCK_CAPTURE_EDITOR_CHANNELS,
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
} from '../dock-conversation-slice';
import { evidenceOf, dockMediaNativeService } from './dock-evidence-saga';

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

function* persist({
  payload: [requestId, request, authority],
}: SaveAction): SagaGenerator<void> {
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
    yield* put(
      result({ result: applied.status === 'invalid-edit' ? 'failed' : applied.status }),
    );
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
        current()
          ? { result: 'saved', saved: applied.media.saved! }
          : { result: 'stale-source' },
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
function publishedMediaItem(workspaceId: string, agentId: string, logicalId: string, expected: DockSavedMedia, contextItemId?: string) {
  const evidence = evidenceOf(workspaceId, agentId);
  const row = [...(evidence?.images ?? []), ...(evidence?.clips ?? [])].find((entry) => entry.id === logicalId);
  if (!row || row.mediaError || row.contextItemId !== contextItemId || JSON.stringify(row.media) !== JSON.stringify(expected)) return null;
  const item = selectComposerContextItems.select(store.state, workspaceId, agentId).find((entry) => entry.id === contextItemId);
  return item?.attachmentId === expected.source.attachmentId && item.path === expected.source.path ? item : null;
}

function* recognizeAndPersist(workspaceId: string, agentId: string, logicalId: string, authority: string): SagaGenerator<void> {
  const service = dockMediaNativeService();
  const initial = evidenceOf(workspaceId, agentId)?.clips.find((row) => row.id === logicalId)?.media;
  if (!initial || !service?.transcribeMedia || initial.source.audio !== 'available' || initial.transcript?.status === 'ready') return;
  const jobId = crypto.randomUUID();
  try {
    const result = yield* call(() => service.transcribeMedia!({ jobId, media: initial }));
    if (!result.ok || authority !== getPrincipalActionContext(store.state) || service !== dockMediaNativeService()) return;
    const liveRow = evidenceOf(workspaceId, agentId)?.clips.find((row) => row.id === logicalId);
    const live = liveRow?.media;
    if (!live || live.source.id !== initial.source.id || live.source.revision !== initial.source.revision) return;
    const transcript = { ...result.value, revision: (live.transcript?.revision ?? 0) + 1 };
    const next = { ...live, transcript };
    if (!replaceMediaState(workspaceId, agentId, logicalId, live, next)) return;
    const ownerId = `dock-media-transcript:${jobId}`, requestId = crypto.randomUUID();
    const settled = yield* actionChannel((action: ReturnType<typeof chatDraftSaveSettled>) =>
      action.type === chatDraftSaveSettled.type && action.payload[0] === ownerId && action.payload[1] === requestId, buffers.expanding());
    try {
      const draft = getItem(store.state.dockConversation.drafts, JSON.stringify([workspaceId, agentId]));
      if (!draft?.restored) return;
      yield* put(chatDraftOwnerOpened(ownerId));
      yield* put(chatDraftSaveScheduled(ownerId, requestId, { workspaceId, agentId, authority, text: draft.text,
        attachments: serializeDraftAttachments(selectComposerContextItems.select(store.state, workspaceId, agentId), toDockDraftEvidence(evidenceOf(workspaceId, agentId))), rollback: null }));
      yield* put(chatDraftSavePairFlushRequested(workspaceId, agentId));
      const { written } = yield* race({ written: take(settled), expired: delay(14_000) });
      if (written?.payload[2] === 'saved' && authority === getPrincipalActionContext(store.state) && service === dockMediaNativeService() &&
          publishedMediaItem(workspaceId, agentId, logicalId, next, liveRow?.contextItemId))
        yield* call(() => window.electronAPI.invoke(DOCK_CAPTURE_EDITOR_CHANNELS.TRANSCRIPT_UPDATE,
          { pair: { workspaceId, agentId }, sourceId: live.source.id, sourceRevision: live.source.revision, transcript }));
    } finally { settled.close(); yield* put(chatDraftOwnerReleased(ownerId)); }
  } finally { yield* call(() => service.releaseMediaJob?.(jobId).catch(() => {})); }
}

/** The editor opens only after the source metadata has passed the same durable writer. */
function* openEditor({ payload: [workspaceId, agentId, logicalId] }: ReturnType<typeof dockMediaEditorOpenRequested>): SagaGenerator<void> {
  const authority = getPrincipalActionContext(store.state), binding = captureDockPlacementBinding();
  if (!authority) return;
  const current = () => getPrincipalActionContext(store.state) === authority && isDockBindingCurrent(binding);
  let evidence = evidenceOf(workspaceId, agentId);
  let row = [...(evidence?.images ?? []), ...(evidence?.clips ?? [])].find((item) => item.id === logicalId);
  if (!evidence || !row || row.mediaError) return;
  let item = selectComposerContextItems.select(store.state, workspaceId, agentId).find((item) => item.id === row!.contextItemId);
  if (!item) return;
  if (!row.media && 'width' in row && item.imageData && item.imageMimeType) {
    const before = JSON.stringify(row), pixels = item.imageData, mime = item.imageMimeType;
    const placed = yield* call(placeDockMediaImage, workspaceId, `capture-original-${crypto.randomUUID()}.png`, { data: pixels, mimeType: mime }, binding);
    if (!current()) return;
    evidence = evidenceOf(workspaceId, agentId);
    const live = evidence?.images.find((entry) => entry.id === logicalId);
    if (!evidence || !live || JSON.stringify(live) !== before) return;
    const source = DockMediaSourceSchema.parse({ id: crypto.randomUUID(), revision: 0, kind: 'screenshot',
      attachmentId: placed.attachmentId, path: placed.path, durationMs: 0,
      width: live.width, height: live.height, ...(live.capture ? { capture: live.capture } : {}), audio: 'none', visuals: 'clean', batches: dockMediaCaptureBatches([], 0) });
    source.capturedMarks = dockMediaCapturedMarks(evidence, source, logicalId);
    const items = selectComposerContextItems.select(store.state, workspaceId, agentId);
    store.dispatch(setComposerContextItems(workspaceId, agentId, items.map((entry) => entry.id === item!.id
      ? { ...entry, attachmentId: source.attachmentId, path: source.path, attachmentMimeType: placed.mimeType ?? mime,
          attachmentSize: placed.size, placementStatus: 'placed' as const } : entry)));
    store.dispatch(dockEvidenceMediaChanged(workspaceId, agentId, logicalId, null, { source, saved: null, transcript: null }));
    row = evidenceOf(workspaceId, agentId)?.images.find((entry) => entry.id === logicalId);
    item = selectComposerContextItems.select(store.state, workspaceId, agentId).find((entry) => entry.id === item!.id);
  }
  if (!row || !item || !current()) return;
  // Legacy recordings stay read-only; no guessed dimensions, batches or clean pixels.
  const media = row.media, source = media?.source;
  if (!source || !media) return;
  const ownerId = `dock-media-source:${crypto.randomUUID()}`, requestId = crypto.randomUUID();
  const settled = yield* actionChannel((action: ReturnType<typeof chatDraftSaveSettled>) =>
    action.type === chatDraftSaveSettled.type && action.payload[0] === ownerId && action.payload[1] === requestId, buffers.expanding());
  try {
    const draft = getItem(store.state.dockConversation.drafts, JSON.stringify([workspaceId, agentId]));
    if (!draft?.restored) return;
    yield* put(chatDraftOwnerOpened(ownerId));
    yield* put(chatDraftSaveScheduled(ownerId, requestId, { workspaceId, agentId, authority, text: draft.text,
      attachments: serializeDraftAttachments(selectComposerContextItems.select(store.state, workspaceId, agentId), toDockDraftEvidence(evidenceOf(workspaceId, agentId))), rollback: null }));
    yield* put(chatDraftSavePairFlushRequested(workspaceId, agentId));
    const { written } = yield* race({ written: take(settled), expired: delay(14_000) });
    if (!written || written.payload[2] !== 'saved' || !current()) return;
    const published = publishedMediaItem(workspaceId, agentId, logicalId, media, row.contextItemId);
    if (!published || published.id !== item.id) return;
    const request: DockCaptureEditorOpenRequest = {
      kind: source.kind, workspaceId, agentId, attachmentId: source.attachmentId,
      sourceRevision: String(source.revision), attachmentPath: source.path, title: published.label,
      width: source.width, height: source.height, durationMs: source.durationMs,
      provenance: { hasMicAudio: source.audio === 'available', visuals: source.visuals },
      marks: [], source, saved: media.saved, transcript: media.transcript,
    };
    yield* call(() => window.electronAPI.invoke(DOCK_CAPTURE_EDITOR_CHANNELS.OPEN, request));
    yield* recognizeAndPersist(workspaceId, agentId, logicalId, authority);
  } finally { settled.close(); yield* put(chatDraftOwnerReleased(ownerId)); }
}

/** Sole dock listener; the editor and main have separate, strictly bound ends. */
export function* dockMediaEditSaga(): SagaGenerator<void> {
  const completed = yield* actionChannel(dockMediaEditSaveSettled, buffers.expanding());
  yield* takeEveryByContextFIFO(dockMediaEditorOpenRequested,
    ({ payload: [workspaceId, agentId] }: ReturnType<typeof dockMediaEditorOpenRequested>) => JSON.stringify([workspaceId, agentId]),
    function* (action) { try { yield* openEditor(action); } catch { /* Source/placement errors keep the current draft. */ } }, {});
  yield* takeEveryByContextFIFO(
    dockMediaEditSaveRequested,
    ({ payload: [, request, authority] }: SaveAction) =>
      JSON.stringify([authority, request.pair]),
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
    completed.close();
  }
}
