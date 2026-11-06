/** Saved, source-relative edits. Originals and recognition timings are never rewritten. */
import { z } from 'zod';
import { DockGestureProgressSchema } from './dock-gesture-progress';

const finite = z.number().finite();
const ms = finite.nonnegative();
const revision = z.number().int().nonnegative();
const id = z.string().min(1).max(512);
export const DockMediaRangeSchema = z
  .object({ startMs: ms, endMs: ms })
  .strict()
  .refine((r) => r.endMs >= r.startMs, 'Reversed range');
export type DockMediaRange = z.infer<typeof DockMediaRangeSchema>;
const point = z.object({ x: finite, y: finite }).strict();
export const DockMediaRectSchema = z
  .object({ x: finite, y: finite, w: finite.positive(), h: finite.positive() })
  .strict();
export type DockMediaRect = z.infer<typeof DockMediaRectSchema>;
export const DockMediaBlurRegionSchema = DockMediaRectSchema.extend({ id });
export type DockMediaBlurRegion = z.infer<typeof DockMediaBlurRegionSchema>;
export const DOCK_MEDIA_BLUR_RADIUS = 16;
export const DOCK_MEDIA_OUTPUT_VERSION = 2;
export const DockMediaBlurStrokeSchema = z.object({
  id, radius: finite.positive().max(4096), points: z.array(point).min(1).max(4096),
}).strict();
export type DockMediaBlurStroke = z.infer<typeof DockMediaBlurStrokeSchema>;
export function dockMediaBlurStrokeBounds(stroke: DockMediaBlurStroke): DockMediaRect {
  const xs = stroke.points.map((p) => p.x), ys = stroke.points.map((p) => p.y);
  const x = Math.min(...xs) - stroke.radius, y = Math.min(...ys) - stroke.radius;
  return { x, y, w: Math.max(...xs) + stroke.radius - x, h: Math.max(...ys) + stroke.radius - y };
}
export function transformDockMediaBlurStroke(stroke: DockMediaBlurStroke,
  mapping: { scaleX: number; scaleY: number; offsetX: number; offsetY: number }): DockMediaBlurStroke {
  // Preserve coverage conservatively if a retake has nonuniform pixel scaling.
  return DockMediaBlurStrokeSchema.parse({ ...stroke,
    radius: stroke.radius * Math.max(Math.abs(mapping.scaleX), Math.abs(mapping.scaleY)),
    points: stroke.points.map((p) => ({ x: p.x * mapping.scaleX + mapping.offsetX, y: p.y * mapping.scaleY + mapping.offsetY })),
  });
}
export const DockMediaGeometrySchema = z.discriminatedUnion('kind', [
  DockMediaRectSchema.extend({ kind: z.literal('rect') }),
  z.object({ kind: z.literal('point'), x: finite, y: finite }).strict(),
  z.object({ kind: z.literal('path'), points: z.array(point).min(1).max(4096) }).strict(),
  z.object({ kind: z.literal('arrow'), from: point, to: point }).strict(),
  z
    .object({
      kind: z.literal('text'),
      x: finite,
      y: finite,
      text: z.string().max(10000),
      fontSize: finite.positive(),
      style: z.literal('sticky').optional(),
      width: finite.positive().max(4096).optional(),
      padding: finite.nonnegative().max(1024).optional(),
    })
    .strict(),
]);
export type DockMediaGeometry = z.infer<typeof DockMediaGeometrySchema>;
/** Shared card wrapping/bounds for painting, hit testing, crop and retake. */
export function layoutDockMediaText(g: Extract<DockMediaGeometry, { kind: 'text' }>): {
  lines: string[]; width: number; height: number; padding: number; lineHeight: number;
} {
  const lineHeight = g.fontSize * 1.4, padding = g.style === 'sticky' ? (g.padding ?? 8) : 0;
  if (g.style !== 'sticky') {
    const lines = g.text.split('\n');
    return { lines, width: Math.max(1, ...lines.map((line) => line.length)) * g.fontSize * 0.65,
      height: lines.length * lineHeight, padding, lineHeight };
  }
  const width = Math.max(padding * 2 + 1, g.width ?? 240);
  const maxChars = Math.max(1, Math.floor((width - padding * 2) / (g.fontSize * 0.65)));
  const lines: string[] = [];
  for (const paragraph of g.text.split('\n')) {
    let remaining = paragraph;
    while (remaining.length > maxChars) {
      const space = remaining.lastIndexOf(' ', maxChars);
      const end = space > 0 ? space : maxChars;
      lines.push(remaining.slice(0, end).trimEnd());
      remaining = remaining.slice(end).trimStart();
    }
    lines.push(remaining);
  }
  return { lines, width, height: lines.length * lineHeight + padding * 2, padding, lineHeight };
}
/** Retake/resize preserves the label's source-pixel presentation parameters. */
export function transformDockMediaText(g: Extract<DockMediaGeometry, { kind: 'text' }>,
  mapping: { scaleX: number; scaleY: number; offsetX: number; offsetY: number }): Extract<DockMediaGeometry, { kind: 'text' }> {
  const layout = layoutDockMediaText(g);
  const parsed = DockMediaGeometrySchema.parse({ ...g,
    x: g.x * mapping.scaleX + mapping.offsetX, y: g.y * mapping.scaleY + mapping.offsetY,
    fontSize: g.fontSize * Math.abs(mapping.scaleY),
    ...(g.style === 'sticky' ? { width: layout.width * Math.abs(mapping.scaleX),
      padding: layout.padding * Math.min(Math.abs(mapping.scaleX), Math.abs(mapping.scaleY)) } : {}),
  });
  if (parsed.kind !== 'text') throw new Error('invalid-text-transform');
  return parsed;
}
export const DockMediaEditMarkSchema = z
  .object({
    gestureProgress: DockGestureProgressSchema.optional(),
    id,
    atMs: ms,
    batchId: id,
    source: z.enum(['recording', 'editor']),
    kind: z.enum(['click', 'box', 'draw', 'arrow', 'element', 'text']),
    included: z.boolean(),
    geometry: DockMediaGeometrySchema,
    label: z.string().max(2048),
    note: z.string().max(20000),
    context: z
      .object({
        selector: z.string().max(8192).nullable(),
        text: z.string().max(20000).nullable(),
        url: z.string().max(8192).nullable(),
      })
      .strict(),
  })
  .strict();
export type DockMediaEditMark = z.infer<typeof DockMediaEditMarkSchema>;
export const DockMediaBatchSchema = z
  .object({ id, atMs: ms, clearAtMs: ms.nullable() })
  .strict()
  .refine(
    (batch) => batch.clearAtMs === null || batch.clearAtMs >= batch.atMs,
    'Reversed batch',
  );
export type DockMediaBatch = z.infer<typeof DockMediaBatchSchema>;
/** Global screen points use Electron's top-left display coordinate convention. */
export const DockMediaCaptureSchema = z.object({
  mode: z.enum(['fullscreen', 'window', 'region']),
  frame: z.object({ displayId: z.number().int(), rect: DockMediaRectSchema,
    coordinateSpace: z.literal('screen-points-top-left') }).strict().nullable(),
}).strict();
export type DockMediaCapture = z.infer<typeof DockMediaCaptureSchema>;
export const DockMediaSourceSchema = z
  .object({
    /** Immutable pixel-generation identity; a retake may replace it under the same logical attachment. */
    id,
    revision,
    kind: z.enum(['recording', 'screenshot']),
    capture: DockMediaCaptureSchema.optional(),
    /** Daemon file attachment identity, distinct from the logical image/clip ID. */
    attachmentId: id,
    path: z
      .string()
      .refine(
        (path) =>
          path.startsWith('.intent/attachments/') &&
          !/[\\\x00]/.test(path) &&
          !path.split('/').some((p) => !p || p === '.' || p === '..'),
        'Invalid attachment path',
      ),
    durationMs: ms,
    width: finite.positive(),
    height: finite.positive(),
    audio: z.enum(['available', 'none', 'unknown']),
    /** Actual Clear boundaries, independent of microphone or transcription status. */
    batches: z.array(DockMediaBatchSchema).max(10000),
    visuals: z.enum(['clean', 'baked-marks']),
    /** Immutable capture baseline. Missing legacy baselines cannot offer Reset. */
    capturedMarks: z.array(DockMediaEditMarkSchema).max(10000).optional(),
    /** Known original representation. Missing legacy baselines can play but cannot export edits. */
    bakedMarks: z.array(DockMediaEditMarkSchema).max(10000).optional(),
  })
  .strict()
  .superRefine((source, ctx) => {
    for (const mark of source.capturedMarks ?? []) {
      const progress = mark.gestureProgress;
      if (progress && (source.kind !== 'recording' || progress.completedAtMs > source.durationMs ||
          progress.samples.some((sample) => sample.atMs < mark.atMs ||
            (mark.geometry.kind === 'path' && sample.pointCount > mark.geometry.points.length))))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['capturedMarks'], message: 'Gesture timing does not match the recording' });
    }
    if (source.kind === 'recording' && source.durationMs <= 0)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['durationMs'],
        message: 'Recording duration is missing',
      });
  });
export type DockMediaSource = z.infer<typeof DockMediaSourceSchema>;
export const DockMediaTranscriptSchema = z
  .object({
    status: z.enum(['pending', 'ready', 'no-speech', 'unavailable', 'failed']),
    revision,
    words: z
      .array(
        z
          .object({
            id,
            text: z.string().max(20000),
            startMs: ms.nullable(),
            endMs: ms.nullable(),
            alignment: z.enum(['word', 'segment', 'untimed']),
          })
          .strict()
          .superRefine((word, ctx) => {
            if (
              (word.startMs === null) !== (word.endMs === null) ||
              (word.startMs !== null && word.endMs !== null && word.endMs < word.startMs)
            )
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Incomplete or reversed recognition timing',
              });
            if (word.alignment !== 'untimed' && (word.startMs === null || word.endMs === null))
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Timed recognition units require genuine timestamps',
              });
            if (word.alignment === 'untimed' && word.startMs !== null)
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Untimed text cannot claim timestamps',
              });
          }),
      )
      .max(200000),
    error: z.string().max(2048).optional(),
  })
  .strict();
export type DockMediaTranscript = z.infer<typeof DockMediaTranscriptSchema>;
export const DockMediaChoiceSchema = z
  .object({
    video: z.enum(['full', 'highlights']),
    voice: z.enum(['audio', 'transcript', 'off']),
  })
  .strict();
export type DockMediaChoice = z.infer<typeof DockMediaChoiceSchema>;
export const DockMediaEditSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum(['recording', 'screenshot']),
    sourceId: id,
    sourceRevision: revision,
    revision,
    trim: DockMediaRangeSchema,
    cuts: z.array(DockMediaRangeSchema).max(10000),
    marks: z.array(DockMediaEditMarkSchema).max(10000),
    blurRegions: z.array(DockMediaBlurRegionSchema).max(1000),
    blurStrokes: z.array(DockMediaBlurStrokeSchema).max(1000).optional(),
    crop: DockMediaRectSchema.nullable(),
    video: z.enum(['full', 'highlights']),
    voice: z.enum(['audio', 'transcript', 'off']),
    /** Corrections affect sent text only, keyed by genuine recognition unit IDs. */
    wordEdits: z.record(z.string().max(20000)),
  })
  .strict()
  .superRefine((edit, ctx) => {
    const ids = new Set<string>();
    for (const mark of edit.marks) {
      if (ids.has(mark.id))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['marks'],
          message: 'Duplicate mark identity',
        });
      ids.add(mark.id);
    }
  });
export type DockMediaEdit = z.infer<typeof DockMediaEditSchema>;
export const DockMediaSaveRequestSchema = z
  .object({
    openId: id,
    outputVersion: z.literal(DOCK_MEDIA_OUTPUT_VERSION).optional(),
    sourceId: id,
    sourceRevision: revision,
    pair: z.object({ workspaceId: id, agentId: id }).strict(),
    expectedEditRevision: revision,
    edit: DockMediaEditSchema,
    /** Main authorizes and fills source from this session's immutable candidate. */
    replacement: z
      .object({ candidateToken: id, source: DockMediaSourceSchema })
      .strict()
      .optional(),
  })
  .strict()
  .refine((request) => (
    !(request.edit.blurStrokes?.length || request.edit.marks.some((mark) => mark.geometry.kind === 'text' && mark.geometry.style === 'sticky')) ||
    request.outputVersion === DOCK_MEDIA_OUTPUT_VERSION
  ), 'This edit requires an admitted output version');
export type DockMediaSaveRequest = z.infer<typeof DockMediaSaveRequestSchema>;
export const DOCK_MEDIA_CHOICE_PREF = 'dock-media-last-saved-choice-v1';

export type DockMediaOutputError =
  | 'stale-source'
  | 'invalid-edit'
  | 'legacy-baked-marks'
  | 'transcript-pending'
  | 'transcript-unavailable'
  | 'timing-unavailable'
  | 'audio-unavailable';
export interface DockMediaOutputPlan {
  /** Playback skip ranges: trim minus cuts, regardless of the Video send choice. */
  kept: DockMediaRange[];
  /** Actual video exports, in source-time order; highlights merge before cuts. */
  clips: DockMediaRange[];
  muted: boolean;
  marks: Array<{
    n: number;
    mark: DockMediaEditMark;
    frameAtMs: number;
    visibleUntilMs: number;
  }>;
  transcript: string | null;
  errors: DockMediaOutputError[];
}
export function mergeDockMediaRanges(ranges: readonly DockMediaRange[]): DockMediaRange[] {
  const ordered = ranges
    .filter(
      (r) => Number.isFinite(r.startMs) && Number.isFinite(r.endMs) && r.endMs > r.startMs,
    )
    .map((r) => ({ ...r }))
    .sort((a, b) => a.startMs - b.startMs);
  const result: DockMediaRange[] = [];
  for (const range of ordered) {
    const last = result.at(-1);
    if (last && range.startMs <= last.endMs) last.endMs = Math.max(last.endMs, range.endMs);
    else result.push(range);
  }
  return result;
}
export function subtractDockMediaRanges(
  ranges: readonly DockMediaRange[],
  cuts: readonly DockMediaRange[],
): DockMediaRange[] {
  let result = mergeDockMediaRanges(ranges);
  for (const cut of mergeDockMediaRanges(cuts))
    result = result.flatMap((range) =>
      cut.endMs <= range.startMs || cut.startMs >= range.endMs
        ? [range]
        : [
            ...(cut.startMs > range.startMs
              ? [{ startMs: range.startMs, endMs: cut.startMs }]
              : []),
            ...(cut.endMs < range.endMs ? [{ startMs: cut.endMs, endMs: range.endMs }] : []),
          ],
    );
  return result;
}
function atTime(atMs: number, ranges: readonly DockMediaRange[], durationMs: number) {
  const at = atMs === durationMs ? Math.max(0, atMs - 0.001) : atMs;
  return ranges.some((range) => at >= range.startMs && at < range.endMs);
}
export const DOCK_MEDIA_POINT_RADIUS = 6;

/** Canonical source-pixel hit/crop/resize rectangle. Text uses top-left and all lines. */
export function dockMediaGeometryRect(g: DockMediaGeometry): DockMediaRect {
  if (g.kind === 'point')
    return {
      x: g.x - DOCK_MEDIA_POINT_RADIUS,
      y: g.y - DOCK_MEDIA_POINT_RADIUS,
      w: DOCK_MEDIA_POINT_RADIUS * 2,
      h: DOCK_MEDIA_POINT_RADIUS * 2,
    };
  if (g.kind === 'rect') return { x: g.x, y: g.y, w: g.w, h: g.h };
  if (g.kind === 'text') {
    const layout = layoutDockMediaText(g);
    return { x: g.x, y: g.y, w: layout.width, h: layout.height };
  }
  const points = g.kind === 'path' ? g.points : [g.from, g.to];
  const left = Math.min(...points.map((p) => p.x)),
    top = Math.min(...points.map((p) => p.y));
  return {
    x: left,
    y: top,
    w: Math.max(1, Math.max(...points.map((p) => p.x)) - left),
    h: Math.max(1, Math.max(...points.map((p) => p.y)) - top),
  };
}
function croppedOut(mark: DockMediaEditMark, crop: DockMediaEdit['crop']): boolean {
  if (!crop) return false;
  const bounds = dockMediaGeometryRect(mark.geometry);
  return (
    bounds.x + bounds.w < crop.x ||
    bounds.x > crop.x + crop.w ||
    bounds.y + bounds.h < crop.y ||
    bounds.y > crop.y + crop.h
  );
}
export function canUseHighlights(edit: DockMediaEdit): boolean {
  const kept = subtractDockMediaRanges([edit.trim], edit.cuts);
  return edit.marks.some((mark) => mark.included && atTime(mark.atMs, kept, edit.trim.endMs));
}
export function markRemovable(source: DockMediaSource): boolean {
  return source.visuals === 'clean';
}
export function voiceOptions(source: DockMediaSource, transcript: DockMediaTranscript | null) {
  const recording = source.kind === 'recording';
  const transcriptReady = transcript?.status === 'ready';
  return {
    audio: {
      enabled: recording && source.audio === 'available',
      reason: source.audio === 'available' ? null : ('audio-unavailable' as const),
    },
    transcript: {
      enabled: recording && transcriptReady,
      reason: transcriptReady
        ? null
        : transcript?.status === 'pending'
          ? ('transcript-pending' as const)
          : ('transcript-unavailable' as const),
    },
    off: { enabled: true, reason: null },
  };
}
export function defaultDockMediaEdit(
  source: DockMediaSource,
  marks: readonly DockMediaEditMark[],
  transcript: DockMediaTranscript | null,
  rememberedChoice: DockMediaChoice | null = null,
): DockMediaEdit {
  const edit: DockMediaEdit = {
    version: 1,
    kind: source.kind,
    sourceId: source.id,
    sourceRevision: source.revision,
    revision: 0,
    trim: { startMs: 0, endMs: source.durationMs },
    cuts: [],
    marks: structuredClone([...marks]),
    blurRegions: [],
    blurStrokes: [],
    crop: null,
    video: rememberedChoice?.video ?? 'highlights',
    voice: rememberedChoice?.voice ?? 'transcript',
    wordEdits: {},
  };
  if (source.kind === 'screenshot') {
    edit.video = 'full';
    edit.voice = 'off';
    return edit;
  }
  if (!canUseHighlights(edit)) edit.video = 'full';
  if (source.audio === 'none' || transcript?.status === 'no-speech') edit.voice = 'off';
  else if (edit.voice === 'audio' && source.audio !== 'available') edit.voice = 'off';
  // Missing/pending/failed transcript never silently opts the user into sending audio.
  return edit;
}
function transcriptText(
  edit: DockMediaEdit,
  source: DockMediaSource,
  transcript: DockMediaTranscript,
  marks: DockMediaOutputPlan['marks'],
  kept: DockMediaRange[],
): { text: string; timingMissing: boolean } {
  const events: Array<{ at: number; order: number; text: string }> = [];
  const editingTime =
    edit.cuts.length > 0 || edit.trim.startMs > 0 || edit.trim.endMs < source.durationMs;
  let timingMissing = false;
  let previousTimed: { at: number; order: number; text: string } | null = null;
  for (const word of transcript.words) {
    if (word.startMs === null || word.endMs === null) {
      const text = edit.wordEdits[word.id] ?? word.text;
      // Recognition punctuation has lexical adjacency, not an independent
      // timestamp. Keep it with its preceding retained recognition unit.
      if (/^[\s\p{P}]*$/u.test(text)) {
        if (previousTimed && text.trim()) previousTimed.text += text.trim();
        continue;
      }
      if ((editingTime || marks.length > 0) && word.text.trim()) timingMissing = true;
      else
        events.push({
          at: Number.MAX_SAFE_INTEGER - 1,
          order: 1,
          text: edit.wordEdits[word.id] ?? word.text,
        });
      continue;
    }
    // Genuine segment boundaries are indivisible: never guess word timing inside them.
    const overlaps = kept.some(
      (range) => word.startMs! < range.endMs && word.endMs! > range.startMs,
    );
    const contained = kept.some(
      (range) => word.startMs! >= range.startMs && word.endMs! <= range.endMs,
    );
    if (overlaps && !contained) timingMissing = true;
    previousTimed = contained ? { at: word.startMs, order: 1, text: edit.wordEdits[word.id] ?? word.text } : null;
    if (previousTimed) events.push(previousTimed);
  }
  for (const { n, mark } of marks)
    events.push({ at: mark.atMs, order: 2, text: `[mark ${n}: ${mark.label || mark.kind}]` });
  for (const batch of source.batches)
    if (atTime(batch.atMs, kept, source.durationMs))
      events.push({ at: batch.atMs, order: 0, text: '\n\n' });
  const text = events
    .sort((a, b) => a.at - b.at || a.order - b.order)
    .map((item) => item.text)
    .join(' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
  return { text, timingMissing };
}
/** An editor-added mark joins the actual capture batch containing its source-time position. */
export function dockMediaBatchAt(source: DockMediaSource, atMs: number): DockMediaBatch | null {
  return (
    [...source.batches]
      .sort((a, b) => b.atMs - a.atMs)
      .find(
        (batch) => atMs >= batch.atMs && (batch.clearAtMs === null || atMs < batch.clearAtMs),
      ) ?? null
  );
}
/** Creation order is canonical; excluded/cropped/cut marks receive no output number. */
export function numberDockMediaMarks(
  edit: DockMediaEdit,
  source: DockMediaSource,
): DockMediaOutputPlan['marks'] {
  const kept = subtractDockMediaRanges([edit.trim], edit.cuts);
  return edit.marks
    .filter(
      (mark) =>
        mark.included &&
        !croppedOut(mark, edit.crop) &&
        (source.kind === 'screenshot' || atTime(mark.atMs, kept, source.durationMs)),
    )
    .map((mark, index) => ({
      n: index + 1,
      mark,
      frameAtMs: Math.min(mark.atMs, Math.max(0, source.durationMs - 1)),
      visibleUntilMs:
        source.batches.find((batch) => batch.id === mark.batchId)?.clearAtMs ??
        source.durationMs,
    }));
}
/** Pure plan only. A plan is not a claim that native export or placement has succeeded. */
export function planDockMediaOutput(
  edit: DockMediaEdit,
  source: DockMediaSource,
  transcript: DockMediaTranscript | null,
): DockMediaOutputPlan {
  const errors: DockMediaOutputError[] = [];
  const empty: DockMediaOutputPlan = {
    kept: [],
    clips: [],
    muted: true,
    marks: [],
    transcript: null,
    errors,
  };
  if (
    !DockMediaEditSchema.safeParse(edit).success ||
    !DockMediaSourceSchema.safeParse(source).success
  ) {
    errors.push('invalid-edit');
    return empty;
  }
  if (
    edit.kind !== source.kind ||
    edit.sourceId !== source.id ||
    edit.sourceRevision !== source.revision
  ) {
    errors.push('stale-source');
    return empty;
  }
  if (
    edit.trim.endMs > source.durationMs ||
    edit.trim.startMs > source.durationMs ||
    (edit.crop &&
      (edit.crop.x < 0 ||
        edit.crop.y < 0 ||
        edit.crop.x + edit.crop.w > source.width ||
        edit.crop.y + edit.crop.h > source.height))
  ) {
    errors.push('invalid-edit');
    return empty;
  }
  if (
    source.visuals === 'baked-marks' &&
    (edit.blurRegions.length > 0 || (edit.blurStrokes?.length ?? 0) > 0 ||
      JSON.stringify(edit.marks) !== JSON.stringify(source.bakedMarks) ||
      (!!source.bakedMarks?.length &&
        (edit.cuts.length > 0 ||
          !!edit.crop ||
          edit.trim.startMs > 0 ||
          edit.trim.endMs < source.durationMs)))
  ) {
    errors.push('legacy-baked-marks');
    return empty;
  }
  const strokes = edit.blurStrokes ?? [];
  if (new Set(strokes.map((stroke) => stroke.id)).size !== strokes.length ||
      strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) > 200000 ||
      strokes.some((stroke) => stroke.points.some((p) => p.x < 0 || p.y < 0 || p.x > source.width || p.y > source.height))) {
    errors.push('invalid-edit'); return empty;
  }
  const kept = subtractDockMediaRanges([edit.trim], edit.cuts);
  const marks = numberDockMediaMarks(edit, source);
  const included = marks.map((row) => row.mark);
  const clips =
    source.kind === 'screenshot'
      ? []
      : edit.video === 'full'
        ? kept
        : subtractDockMediaRanges(
            mergeDockMediaRanges(
              included.map((mark) => ({
                startMs: Math.max(edit.trim.startMs, mark.atMs - 3000),
                endMs: Math.min(edit.trim.endMs, mark.atMs + 3000),
              })),
            ),
            edit.cuts,
          );
  if (edit.voice === 'audio' && source.audio !== 'available') errors.push('audio-unavailable');
  let text: string | null = null;
  if (source.kind === 'recording' && edit.voice === 'transcript') {
    if (!transcript || transcript.status !== 'ready')
      errors.push(
        transcript?.status === 'pending' ? 'transcript-pending' : 'transcript-unavailable',
      );
    else {
      const projected = transcriptText(edit, source, transcript, marks, kept);
      text = projected.text;
      if (projected.timingMissing) errors.push('timing-unavailable');
    }
  }
  return { kept, clips, muted: edit.voice !== 'audio', marks, transcript: text, errors };
}

/** Persisted with its owning attachment; never a second editor-owned preference store. */
export const DockSavedMediaSchema = z
  .object({
    source: DockMediaSourceSchema,
    /** First captured pixel generation survives retakes for recovery/Reset. */
    originalSource: DockMediaSourceSchema.optional(),
    saved: DockMediaEditSchema.nullable(),
    transcript: DockMediaTranscriptSchema.nullable(),
  })
  .strict()
  .superRefine((media, ctx) => {
    if (
      media.saved &&
      (media.saved.sourceId !== media.source.id ||
        media.saved.sourceRevision !== media.source.revision ||
        media.saved.kind !== media.source.kind)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Saved edit belongs to a different source',
      });
  });
export type DockSavedMedia = z.infer<typeof DockSavedMediaSchema>;
export type DockMediaSaveResult =
  | { status: 'saved'; media: DockSavedMedia }
  | { status: 'stale-source' | 'revision-conflict' | 'invalid-edit' };
export function applyDockMediaSave(
  media: DockSavedMedia,
  request: DockMediaSaveRequest,
): DockMediaSaveResult {
  if (
    !DockMediaSaveRequestSchema.safeParse(request).success ||
    !DockSavedMediaSchema.safeParse(media).success
  )
    return { status: 'invalid-edit' };
  if (request.sourceId !== media.source.id || request.sourceRevision !== media.source.revision)
    return { status: 'stale-source' };
  if (
    request.expectedEditRevision !== (media.saved?.revision ?? 0) ||
    request.edit.revision !== request.expectedEditRevision
  )
    return { status: 'revision-conflict' };
  const source = request.replacement?.source ?? media.source;
  if (
    source.kind !== media.source.kind ||
    (request.replacement && (source.kind !== 'screenshot' || source.id === media.source.id)) ||
    request.edit.sourceId !== source.id ||
    request.edit.sourceRevision !== source.revision ||
    request.edit.kind !== source.kind
  )
    return { status: 'stale-source' };
  const planned = planDockMediaOutput(request.edit, source, media.transcript);
  if (
    planned.errors.some(
      (error) =>
        error === 'invalid-edit' || error === 'legacy-baked-marks' || error === 'stale-source',
    )
  )
    return { status: 'invalid-edit' };
  return {
    status: 'saved',
    media: {
      ...media,
      source,
      ...(request.replacement
        ? { originalSource: media.originalSource ?? media.source, transcript: null }
        : {}),
      saved: { ...structuredClone(request.edit), revision: request.expectedEditRevision + 1 },
    },
  };
}

/** Reset cannot invent an empty baseline for an older attachment. */
export function originalDockMediaEdit(
  media: DockSavedMedia,
): { source: DockMediaSource; edit: DockMediaEdit } | null {
  const source = media.originalSource ?? media.source;
  if (!source.capturedMarks) return null;
  return {
    source,
    edit: { ...defaultDockMediaEdit(source, source.capturedMarks, media.transcript, null), revision: media.saved?.revision ?? 0 },
  };
}

/** No origin is inferred for legacy/window/region captures lacking a verified frame. */
export function dockMediaRetakeMapping(from: DockMediaSource, to: DockMediaSource): { scaleX: number; scaleY: number; offsetX: number; offsetY: number } | null {
  const a = from.capture?.frame, b = to.capture?.frame;
  if (!a || !b || a.displayId !== b.displayId || from.kind !== 'screenshot' || to.kind !== 'screenshot') return null;
  const x = to.width / b.rect.w, y = to.height / b.rect.h;
  return { scaleX: a.rect.w / from.width * x, scaleY: a.rect.h / from.height * y,
    offsetX: (a.rect.x - b.rect.x) * x, offsetY: (a.rect.y - b.rect.y) * y };
}
