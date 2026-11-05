/** Materialize the click's immutable media edits before message admission. */
import type { DockComposerEvidence, DockEvidenceNativeService } from '$shared/dock-evidence';
import { defaultDockMediaEdit, planDockMediaOutput, type DockSavedMedia } from '$shared/dock-media-edit';
import { renderDockMediaImage, renderDockMediaOverlay } from './dock-media-render';
import { fetchDockMediaBytes } from './dock-media-clipboard';
import { arrayBufferToBase64 } from '$features/voice/utils/wav-encoder';
import { placeAttachmentViaTransport, mintPlacementIdempotencyKey } from '$lib/components/chat/input/attachment-placement';
import { intentFileMediaUrlToWorkspaceFile } from '$lib/utils/workspace-file-image';
import { isDockBindingCurrent, type DockPlacementBinding } from './dock-evidence-placement';
export interface DockMediaSendResult {
  images: Record<string, { data: string; mimeType: string; width: number; height: number }>;
  files: Array<{ type: 'file'; attachmentId: string; fileName: string; mimeType: string; size: number }>;
  frames: Array<{ type: 'image'; attachmentId: string; mimeType: string }>;
  metadata: Array<Record<string, unknown>>;
}
export async function prepareDockMediaSend(workspaceId: string, evidence: DockComposerEvidence,
  binding: DockPlacementBinding, service: DockEvidenceNativeService | null,
  current: () => boolean): Promise<DockMediaSendResult> {
  const output: DockMediaSendResult = { images: {}, files: [], frames: [], metadata: [] };
  const check = () => { if (!current() || !isDockBindingCurrent(binding)) throw new Error('media-send-retired'); };
  for (const row of [...evidence.images, ...evidence.clips]) {
    if (row.mediaError) throw new Error('invalid-saved-edit');
    if (!row.media) continue;
    check();
    const media: DockSavedMedia = structuredClone(row.media), source = media.source;
    let edit = media.saved ?? defaultDockMediaEdit(source, source.capturedMarks ?? [], media.transcript);
    const jobId = crypto.randomUUID();
    try {
      if (source.kind === 'recording' && edit.voice === 'transcript' && media.transcript?.status !== 'ready') {
        if (!service?.transcribeMedia) throw new Error('transcript-unavailable');
        const recognized = await service.transcribeMedia({ jobId, media });
        check();
        if (!recognized.ok) throw new Error('transcript-unavailable');
        media.transcript = recognized.value;
        if (!media.saved) edit = defaultDockMediaEdit(source, source.capturedMarks ?? [], media.transcript);
      }
      const plan = planDockMediaOutput(edit, source, media.transcript);
      if (plan.errors.length) throw new Error(plan.errors[0]);
      const meta: Record<string, unknown> = { id: row.id, kind: source.kind, video: edit.video, voice: edit.voice,
        transcript: plan.transcript, batches: source.batches,
        marks: plan.marks.map(({ n, mark, frameAtMs }) => ({ n, id: mark.id, at_ms: frameAtMs, kind: mark.kind,
          label: mark.label, note: mark.note, context: mark.context, geometry: mark.geometry })) };
      if (source.kind === 'screenshot') {
        const encoded = source.path.split('/').map(encodeURIComponent).join('/');
        const resolved = intentFileMediaUrlToWorkspaceFile(`intent://local/file/${encoded}`, workspaceId);
        if (!resolved || resolved.kind !== 'image') throw new Error('media-source-unavailable');
        const bytes = await fetchDockMediaBytes(resolved.url);
        check();
        const pixels = { base64: arrayBufferToBase64(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
          mimeType: /\.jpe?g$/i.test(source.path) ? 'image/jpeg' : /\.webp$/i.test(source.path) ? 'image/webp' : 'image/png' };
        output.images[row.id] = await renderDockMediaImage(source, edit, pixels);
        check();
      } else {
        if (!service?.exportMedia) throw new Error('media-export-unavailable');
        const boundaries = [...new Set([0, source.durationMs, ...plan.marks.flatMap((entry) => [entry.frameAtMs, entry.visibleUntilMs])])].sort((a, b) => a - b);
        const spans = boundaries.slice(0, -1).map((atMs, index) => ({ atMs, endMs: boundaries[index + 1] }))
          .filter((span) => plan.marks.some((entry) => span.atMs >= entry.frameAtMs && span.atMs < entry.visibleUntilMs));
        const layers = [];
        for (const span of spans) { check(); layers.push({ ...span, png: await renderDockMediaOverlay(source, edit, span.atMs) }); }
        const exported = await service.exportMedia({ jobId, media: { ...media, saved: edit }, layers });
        check();
        if (!exported.ok) throw new Error('media-export-failed');
        const files = [exported.value.video, ...exported.value.frames];
        const references = [];
        for (let index = 0; index < files.length; index++) {
          check(); const file = files[index], fileName = `capture-${row.id.slice(0, 12)}-${index}.${index === 0 ? 'mp4' : 'png'}`;
          const placed = await placeAttachmentViaTransport(workspaceId, fileName,
            { sourcePath: file.sourcePath, mimeType: file.mimeType, idempotencyKey: mintPlacementIdempotencyKey() }, undefined, undefined,
            () => current() && isDockBindingCurrent(binding));
          check();
          if (index === 0) output.files.push({ type: 'file', attachmentId: placed.attachmentId, fileName, mimeType: placed.mimeType ?? file.mimeType, size: placed.size });
          else output.frames.push({ type: 'image', attachmentId: placed.attachmentId, mimeType: 'image/png' });
          references.push(placed.attachmentId);
        }
        meta.video_attachment_id = references[0];
        meta.frames = exported.value.frames.map((frame, index) => ({ mark_id: frame.markId, attachment_id: references[index + 1] }));
        meta.kept_ms = plan.clips;
      }
      output.metadata.push(meta);
    } finally {
      // Only this exact native session may release this job; disposal also cancels it.
      await service?.releaseMediaJob?.(jobId).catch(() => {});
    }
  }
  return output;
}
