/**
 * Display of a sent dock message that carries screen evidence: the transcript shows
 * only the person's words, with `[[mark:n]]` / `[[clip:n]]` / `[[clip:n:end]]` as the
 * composer's chips, and the attachments as "Image n" / "Recording n". The
 * agent-readable preamble stays in the message text; it is only hidden here.
 */

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
