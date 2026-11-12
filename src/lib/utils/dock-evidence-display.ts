/**
 * Display of a sent dock message that carries screen evidence: the transcript shows
 * only the person's words, with `[[mark:n]]` / `[[clip:n]]` / `[[clip:n:end]]` as the
 * composer's chips, and the attachments as "Image n" / "Recording n". The
 * agent-readable preamble stays in the message text; it is only hidden here.
 */

import { z } from 'zod';
import { DockMediaEditMarkSchema, DockMediaRangeSchema } from '$shared/dock-media-edit';

type Metadata = Record<string, unknown> | null | undefined;

/** The message's own metadata (the persisted messageMetadata) marks it as dock evidence. */
export function isDockEvidenceMessage(metadata: Metadata): boolean {
  return !!metadata && metadata.type === 'dock_screen_evidence';
}

export type ScreenTokenSegment =
  | { type: 'text'; content: string }
  | { type: 'screen-ref'; kind: 'mark' | 'clip-start' | 'clip-end'; n: number };

const TOKEN = /\[\[(mark|clip):([1-9]\d{0,2})(:end)?\]\]/g;

/** Split text into plain runs and reference tokens (`[[mark:n:end]]` is not a token). */
export function splitScreenTokens(text: string): ScreenTokenSegment[] {
  const segments: ScreenTokenSegment[] = [];
  let offset = 0;
  for (const match of text.matchAll(TOKEN)) {
    const [token, kind, n, end] = match;
    if (kind === 'mark' && end) continue;
    if (match.index > offset)
      segments.push({ type: 'text', content: text.slice(offset, match.index) });
    segments.push({
      type: 'screen-ref',
      kind: kind === 'mark' ? 'mark' : end ? 'clip-end' : 'clip-start',
      n: Number(n),
    });
    offset = match.index + token.length;
  }
  if (offset < text.length) segments.push({ type: 'text', content: text.slice(offset) });
  return segments;
}

interface EvidenceMarkInfo {
  tool: string | null;
  name: string | null;
}

/** Mark n → its tool and picked element name, from the message metadata. */
export function dockEvidenceMarks(metadata: Metadata): Map<number, EvidenceMarkInfo> {
  const marks = new Map<number, EvidenceMarkInfo>();
  const images = Array.isArray(metadata?.images) ? metadata.images : [];
  for (const image of images) {
    const rows = image && typeof image === 'object' ? (image as { marks?: unknown }).marks : null;
    if (!Array.isArray(rows)) continue;
    for (const mark of rows) {
      if (!mark || typeof mark !== 'object') continue;
      const { n, tool, element } = mark as { n?: unknown; tool?: unknown; element?: unknown };
      if (typeof n !== 'number') continue;
      const name =
        element &&
        typeof element === 'object' &&
        typeof (element as { name?: unknown }).name === 'string'
          ? (element as { name: string }).name || null
          : null;
      marks.set(n, { tool: typeof tool === 'string' ? tool : null, name });
    }
  }
  return marks;
}

/**
 * Recording number (1-based, start order) by attachment id, from the metadata's
 * `clips`. Without ids, video file blocks are numbered in their order.
 */
export function dockEvidenceRecordingNumbers(
  metadata: Metadata,
  fileBlocks: readonly { attachmentId?: string; mimeType?: string }[],
): Map<string, number> {
  const numbers = new Map<string, number>();
  const clips = Array.isArray(metadata?.clips) ? metadata.clips : [];
  clips.forEach((clip, index) => {
    const id =
      clip && typeof clip === 'object' ? (clip as { attachment_id?: unknown }).attachment_id : null;
    if (typeof id === 'string' && id) numbers.set(id, index + 1);
  });
  if (numbers.size) return numbers;
  let n = 0;
  for (const block of fileBlocks)
    if (block.attachmentId && block.mimeType?.startsWith('video/'))
      numbers.set(block.attachmentId, (n += 1));
  return numbers;
}

const captureMark = DockMediaEditMarkSchema.pick({
  id: true,
  kind: true,
  label: true,
  note: true,
  context: true,
  geometry: true,
})
  .extend({ n: z.number().int().positive(), at_ms: z.number().finite().nonnegative() })
  .strict();
const editedCapture = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['screenshot', 'recording']),
    video: z.enum(['full', 'highlights']),
    voice: z.enum(['audio', 'transcript', 'off']),
    transcript: z.string().nullable(),
    batches: z.array(z.unknown()).optional(),
    marks: z.array(captureMark).max(1000),
    video_attachment_id: z.string().min(1).nullable().optional(),
    frames: z
      .array(z.object({ mark_id: z.string().min(1), attachment_id: z.string().min(1) }).strict())
      .max(1000)
      .optional(),
    kept_ms: z.array(DockMediaRangeSchema).max(1000).optional(),
  })
  .strict();
export type EditedCapture = z.infer<typeof editedCapture> & { primaryId: string | null };
export interface CaptureResource {
  type: string;
  attachmentId?: string;
  mimeType?: string;
}

/** Join only persisted producer rows to resources actually present on this message. */
export function editedCaptureCards(
  metadata: Metadata,
  blocks: readonly CaptureResource[],
): EditedCapture[] {
  if (!isDockEvidenceMessage(metadata)) return [];
  try {
    if ((JSON.stringify(metadata?.edited_captures)?.length ?? 0) > 262144) return [];
  } catch {
    return [];
  }
  const parsed = z.array(editedCapture).min(1).max(12).safeParse(metadata?.edited_captures);
  if (!parsed.success) return [];
  const rows = parsed.data,
    ids = new Set<string>(),
    resources = new Map(blocks.filter((b) => b.attachmentId).map((b) => [b.attachmentId!, b]));
  const images = Array.isArray(metadata?.images) ? metadata.images : [];
  const result: EditedCapture[] = [];
  for (const row of rows) {
    if (ids.has(row.id)) return [];
    ids.add(row.id);
    if (
      new Set(row.marks.map((mark) => mark.id)).size !== row.marks.length ||
      new Set(row.marks.map((mark) => mark.n)).size !== row.marks.length
    )
      return [];
    let primaryId: string | null = null;
    if (row.kind === 'screenshot') {
      const image = images.find(
        (value) =>
          value && typeof value === 'object' && (value as Record<string, unknown>).id === row.id,
      ) as Record<string, unknown> | undefined;
      if (
        typeof image?.attachment_id !== 'string' ||
        resources.get(image.attachment_id)?.type !== 'image'
      )
        return [];
      primaryId = image.attachment_id;
      if (
        row.video_attachment_id !== undefined ||
        row.frames !== undefined ||
        row.kept_ms !== undefined
      )
        return [];
    } else {
      if (row.video_attachment_id === undefined || !row.frames || !row.kept_ms) return [];
      if (
        row.kept_ms.some(
          (range, index) => index > 0 && range.startMs < row.kept_ms![index - 1].endMs,
        )
      )
        return [];
      primaryId = row.video_attachment_id;
      if (primaryId) {
        const resource = resources.get(primaryId);
        if (
          resource?.type !== 'file' ||
          !['video/mp4', 'video/webm'].includes(resource.mimeType ?? '')
        )
          return [];
      } else if (row.frames.length || row.kept_ms.length) return [];
      const frameIds = new Set<string>();
      for (const frame of row.frames) {
        if (
          frameIds.has(frame.attachment_id) ||
          !row.marks.some((mark) => mark.id === frame.mark_id) ||
          resources.get(frame.attachment_id)?.type !== 'image'
        )
          return [];
        frameIds.add(frame.attachment_id);
      }
    }
    result.push({ ...row, primaryId });
  }
  return result;
}
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  ) ?? '';
/** Visible-text projection: exact known producer envelope at a leading boundary, backed by persisted metadata. Preview availability is independent. */
export function consumeEditedCaptureEnvelope(
  text: string,
  metadata: Metadata,
): { prefix: string; remaining: string } | null {
  const opening = '[Edited capture outputs]\n'; // i18n-ignore (persisted producer marker)
  if (!text.startsWith(opening) || !isDockEvidenceMessage(metadata)) return null;
  try {
    if ((JSON.stringify(metadata?.edited_captures)?.length ?? 0) > 262144) return null;
  } catch {
    return null;
  }
  const known = z.array(editedCapture).min(1).max(12).safeParse(metadata?.edited_captures);
  if (!known.success || new Set(known.data.map((row) => row.id)).size !== known.data.length)
    return null;
  for (const row of known.data) {
    if (
      new Set(row.marks.map((mark) => mark.id)).size !== row.marks.length ||
      new Set(row.marks.map((mark) => mark.n)).size !== row.marks.length
    )
      return null;
    if (
      row.kind === 'screenshot' &&
      (row.video_attachment_id !== undefined ||
        row.frames !== undefined ||
        row.kept_ms !== undefined)
    )
      return null;
    if (
      row.kind === 'recording' &&
      (row.video_attachment_id === undefined || !row.frames || !row.kept_ms)
    )
      return null;
    if (row.kind === 'recording') {
      const frames = row.frames;
      const ranges = row.kept_ms;
      if (!frames || !ranges) return null;
      if (!row.video_attachment_id && (frames.length || ranges.length)) return null;
      if (ranges.some((range, index) => index > 0 && range.startMs < ranges[index - 1].endMs))
        return null;
      const frameIds = new Set<string>();
      for (const frame of frames) {
        if (
          frameIds.has(frame.attachment_id) ||
          !row.marks.some((mark) => mark.id === frame.mark_id)
        )
          return null;
        frameIds.add(frame.attachment_id);
      }
    }
  }
  const end = text.indexOf('\n', opening.length),
    boundary = end < 0 ? text.length : end;
  if (boundary - opening.length > 262144 || (end >= 0 && !text.startsWith('\n\n', end)))
    return null;
  try {
    const json = JSON.parse(text.slice(opening.length, boundary));
    if (canonical(json) !== canonical(metadata?.edited_captures)) return null;
  } catch {
    return null;
  }
  return { prefix: text.slice(0, boundary), remaining: text.slice(boundary).replace(/^\n\n/, '') };
}

/** Ordered provenance from the daemon's bounded, flat batch metadata wrapper. */
export function dockCaptureDisplayCandidates(metadata: Metadata): Record<string, unknown>[] {
  if (metadata && isDockEvidenceMessage(metadata)) return [metadata];
  if (!metadata || !Array.isArray(metadata.mergedMessageMetadata)) return [];
  const parts = metadata.mergedMessageMetadata;
  if (!parts.length || parts.length > 32) return [];
  try {
    if (JSON.stringify(parts).length > 262144) return [];
  } catch {
    return [];
  }
  return parts.filter(
    (part): part is Record<string, unknown> =>
      !!part && typeof part === 'object' && !Array.isArray(part) && isDockEvidenceMessage(part),
  );
}

/** Edit/regenerate additionally requires every retained capture resource to exist. */
export function consumeEditedCapturePrefix(
  text: string,
  metadata: Metadata,
  blocks: readonly CaptureResource[],
): { prefix: string; remaining: string; attachmentIds: string[] } | null {
  const envelope = consumeEditedCaptureEnvelope(text, metadata);
  const rows = envelope ? editedCaptureCards(metadata, blocks) : [];
  if (!envelope || !rows.length) return null;
  return {
    ...envelope,
    attachmentIds: rows.flatMap((row) => [
      ...(row.primaryId ? [row.primaryId] : []),
      ...(row.frames ?? []).map((frame) => frame.attachment_id),
    ]),
  };
}
