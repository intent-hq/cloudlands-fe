/** One evidence-to-message projection shared by the notch and ordinary chat. */
import {
  dockMediaSendsOriginal,
  prepareDockMediaSend,
  type DockMediaSendService,
} from './dock-media-send';
import { DockSendError, dockSendCode } from './dock-send-diagnostics';
import { DOCK_PROMPT_IMAGE_BUDGET } from '$shared/dock-media-frame-budget';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import {
  dockEvidenceImageItemIds,
  buildDockEvidenceContext,
  buildDockEvidenceMetadata,
  dockCompositeSignature,
  numberDockMarks,
  type DockComposerEvidence,
  type DockImagePlacementRecord,
} from '$shared/dock-evidence';
import { burnDockEvidenceImage } from './dock-evidence-render';
import {
  isDockBindingCurrent,
  placeDockEvidenceImages,
  probeDockAttachmentCapabilities,
  type DockPlacementBinding,
} from './dock-evidence-placement';
import type { ContextItem } from '$lib/components/chat/input/context-api';
import type { SendMessagePayload } from '$store/renderer/slices/chat-state/chat-state-types';

/** Evidence originals never ride alongside their rendered primary output. */
export function evidenceMessageItems(
  items: readonly ContextItem[],
  evidence: DockComposerEvidence | null,
): ContextItem[] {
  const images = dockEvidenceImageItemIds(evidence ?? undefined);
  const edited = new Set(
    evidence?.clips
      .filter((clip) => !!clip.media && !dockMediaSendsOriginal(clip.media))
      .map((clip) => clip.contextItemId),
  );
  return items.filter((item) => !images.has(item.id) && !edited.has(item.id));
}
export interface EvidenceMessagePreparation {
  workspaceId: string;
  agentId: string;
  evidence: DockComposerEvidence | null;
  clickedItems: readonly ContextItem[];
  sendItems: readonly ContextItem[];
  clickedPayload: SendMessagePayload & { wsId: string };
  binding: DockPlacementBinding;
  service: DockMediaSendService | null;
  current(): boolean;
  onRecord(record: DockImagePlacementRecord): void;
}
/** Caller freezes items/evidence first and admits only the returned prepared payload. */
export async function prepareEvidenceMessage({
  workspaceId,
  agentId,
  evidence,
  clickedItems,
  sendItems,
  clickedPayload,
  binding,
  service,
  current,
  onRecord,
}: EvidenceMessagePreparation): Promise<(SendMessagePayload & { wsId: string }) | null> {
  const check = () => {
    if (!current() || !isDockBindingCurrent(binding))
      throw new DockSendError('validate', 'media-send-retired');
  };
  check();
  if (
    evidence?.images.some((row) => row.mediaError) ||
    evidence?.clips.some((row) => row.mediaError)
  )
    throw new DockSendError('validate', 'invalid-saved-edit');
  const exported = (clip: DockComposerEvidence['clips'][number]) =>
    !!clip.media && !dockMediaSendsOriginal(clip.media);
  const evidenceContext = evidence
    ? {
        workspaceId,
        agentId,
        appUrl: `intent://local/workspace/${encodeURIComponent(workspaceId)}`,
        clipAttachmentIds: Object.fromEntries(
          evidence.clips.map((clip) => [
            clip.id,
            clickedItems.find((row) => row.id === clip.contextItemId)?.attachmentId ?? null,
          ]),
        ),
      }
    : null;
  // A clip sent as its original goes out as its own raw attachment: the click must hold
  // exactly that placed file, or nothing is sent (the draft stays).
  for (const clip of evidence?.clips ?? []) {
    if (!clip.media || !dockMediaSendsOriginal(clip.media)) continue;
    const item = clickedItems.find((row) => row.id === clip.contextItemId);
    if (
      !item ||
      item.attachmentId !== clip.media.source.attachmentId ||
      item.path !== clip.media.source.path ||
      (item.placementStatus !== undefined && item.placementStatus !== 'placed')
    )
      throw new DockSendError('validate', 'legacy-original-unavailable');
  }
  // Composites come only from the click's snapshot (items + evidence).
  const materialized = evidence
    ? await prepareDockMediaSend(workspaceId, evidence, binding, service, current)
    : { images: {}, files: [], frames: [], framePromptBytes: [], metadata: [] };
  // A recording's markup screenshot only anchors marks the recording itself carries once it
  // is exported with them or sent as its marked original: then it is not sent again. An
  // edit of its own, or any mark of its own (or of a recording that does not carry it),
  // keeps it in the output.
  const carrying = new Set(
    evidence?.clips
      .filter((clip) => exported(clip) || (!!clip.media && dockMediaSendsOriginal(clip.media)))
      .map((clip) => clip.id),
  );
  const carriers = new Set(
    evidence?.clips
      .filter((clip) => carrying.has(clip.id))
      .flatMap((clip) => (clip.captureHistory ?? []).map((entry) => entry.image.id)),
  );
  const outputImages = (evidence?.images ?? []).filter(
    (image) =>
      image.source !== 'annotate' ||
      !!image.media ||
      !carriers.has(image.id) ||
      evidence!.marks.some(
        (mark) => mark.imageId === image.id && !(mark.clipId && carrying.has(mark.clipId)),
      ),
  );
  let burned: Awaited<ReturnType<typeof burnEvidence>> = [];
  try {
    // Numbering stays the composer's: every mark counts, whichever images are sent.
    burned = evidence
      ? await burnEvidence({ ...evidence, images: outputImages }, clickedItems, materialized.images)
      : [];
  } catch (error) {
    throw new DockSendError('burn', dockSendCode(error));
  }
  // The daemon refuses a prompt whose images exceed its budget, before the model and
  // after the message was delivered. Only images whose prompt bytes are certain may
  // refuse a send here: the recording frames main fitted and certified, which the daemon
  // sends unchanged. Every other image is prepared by the daemon, so its size is unknown
  // here (null) and never blocks a valid message (the daemon adapts or reports it).
  const promptImageBytes = materialized.framePromptBytes.reduce<number>(
    (sum, bytes) => sum + (bytes ?? 0),
    0,
  );
  if (promptImageBytes > DOCK_PROMPT_IMAGE_BUDGET)
    throw new DockSendError('validate', 'image-budget-exceeded');
  const editedImageIds = new Set(
    evidence?.images.filter((image) => image.media).map((image) => image.id),
  );
  const wireEvidence = evidence
    ? {
        ...evidence,
        images: outputImages.map((image) =>
          materialized.images[image.id]
            ? {
                ...image,
                width: materialized.images[image.id].width,
                height: materialized.images[image.id].height,
              }
            : image,
        ),
        clips: evidence.clips.filter((clip) => !exported(clip)),
        marks: evidence.marks.filter(
          (mark) =>
            !editedImageIds.has(mark.imageId) &&
            !evidence.clips.some((clip) => exported(clip) && clip.id === mark.clipId),
        ),
      }
    : null;
  check();
  const hasTranscript = materialized.metadata.some(
    (entry) => typeof entry.transcript === 'string' && entry.transcript.trim(),
  );
  if (
    !clickedPayload.text.trim() &&
    !sendItems.length &&
    !clickedPayload.workspaceContextStr?.trim() &&
    !burned.length &&
    !materialized.files.length &&
    !materialized.frames.length &&
    !clickedPayload.imageBlocks?.length &&
    !clickedPayload.fileBlocks?.length &&
    !hasTranscript
  ) {
    return null;
  }
  let evidenceBlocks: {
    type: 'image';
    data?: string;
    mimeType?: string;
    attachmentId?: string;
  }[] = burned;
  let imageAttachments: Record<
    string,
    { attachmentId: string; raw: { attachmentId: string; expiresAt: string } | null }
  > | null = null;
  // Workspaces pre-place composites (and, on retention daemons, raws) before
  // admission so metadata names real references. The assistant workspace does
  // so only where the daemon advertises its registry; otherwise it stays inline.
  const attachmentCapabilities = evidence ? await probeDockAttachmentCapabilities(binding) : null;
  check();
  if (
    evidence &&
    (workspaceId !== CHIEF_WORKSPACE_ID || attachmentCapabilities?.chiefAttachments)
  ) {
    const records = await placeDockEvidenceImages({
      workspaceId,
      binding,
      images: outputImages.map((image, index) => {
        const item = clickedItems.find((row) => row.id === image.contextItemId);
        return {
          image,
          signature: dockCompositeSignature(evidence, image.id),
          composite: { base64: burned[index].data, mimeType: burned[index].mimeType },
          raw:
            !image.media && item?.imageData && item.imageMimeType
              ? { base64: item.imageData, mimeType: item.imageMimeType }
              : null,
        };
      }),
      records: evidence?.placements ?? {},
      onRecord,
    });
    check();
    evidenceBlocks = records.map((record) => ({
      type: 'image' as const,
      attachmentId: record.composite!.attachmentId,
      mimeType: record.composite!.mimeType,
    }));
    imageAttachments = Object.fromEntries(
      records.map((record) => [
        record.imageId,
        { attachmentId: record.composite!.attachmentId, raw: record.raw },
      ]),
    );
  }
  // Marks that go with an exported recording leave the wire evidence; the rest keep the
  // numbers the composer showed and the composites burned.
  const markNumbers = new Map(
    evidence ? numberDockMarks(evidence).map(({ n, mark }) => [mark.id, n]) : [],
  );
  const wireContext =
    evidenceContext && imageAttachments
      ? { ...evidenceContext, imageAttachments, markNumbers }
      : evidenceContext && { ...evidenceContext, markNumbers };
  const payload =
    evidence && wireContext
      ? {
          ...clickedPayload,
          imageBlocks: [
            ...evidenceBlocks,
            ...materialized.frames,
            ...(clickedPayload.imageBlocks ?? []),
          ],
          fileBlocks: [...(clickedPayload.fileBlocks ?? []), ...materialized.files],
          // Models may never see messageMetadata: an agent-readable copy leads the context.
          workspaceContextStr: [
            buildDockEvidenceContext(wireEvidence!, wireContext),
            materialized.metadata.length
              ? `[Edited capture outputs]\n${JSON.stringify(materialized.metadata)}` // i18n-ignore (agent-directed context marker, not user-facing UI)
              : '',
            clickedPayload.workspaceContextStr,
          ]
            .filter(Boolean)
            .join('\n\n'),
          messageMetadata: {
            ...clickedPayload.messageMetadata,
            ...buildDockEvidenceMetadata(wireEvidence!, wireContext),
            edited_captures: materialized.metadata,
          } as unknown as Record<string, unknown>,
        }
      : clickedPayload;
  check();
  return payload;
}
/** Burned composites for the snapshot, in tile order (matches metadata image indexes). */
async function burnEvidence(
  evidence: DockComposerEvidence,
  items: readonly { id: string; imageData?: string; imageMimeType?: string }[],
  edited: Record<string, { data: string; mimeType: string }> = {},
) {
  const numbered = numberDockMarks(evidence);
  return Promise.all(
    evidence.images.map(async (image) => {
      if (edited[image.id]) return { type: 'image' as const, ...edited[image.id] };
      const item = items.find((row) => row.id === image.contextItemId);
      if (!item?.imageData || !item.imageMimeType) throw new Error('dock-evidence-missing-pixels');
      const burned = await burnDockEvidenceImage(
        { base64: item.imageData, mimeType: item.imageMimeType },
        image,
        numbered.filter(({ mark }) => mark.imageId === image.id),
      );
      return { type: 'image' as const, data: burned.base64, mimeType: burned.mimeType };
    }),
  );
}
