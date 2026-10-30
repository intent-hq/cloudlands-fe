/**
 * Dock composer screen evidence: captured images, numbered marks, clips and
 * pending editor insertions for one workspace/agent draft.
 *
 * Pure and JSON-serializable. Pixels stay in the pair's composer context items
 * (referenced by `contextItemId`); no Blob, object URL or DOM handle is stored.
 * Mark numbers are never stored: `n` is the 1-based creation order across all
 * images of the message, so removing an image renumbers everything after it.
 */

import {
  DOCK_ANNOTATION_LIMITS,
  dockHashDistance,
  type DockAnnotationIssue,
  type DockAnnotationMediaState,
} from './dock-annotation';

export const DOCK_MARK_TOOLS = ['pick', 'box', 'pen', 'arrow'] as const;
export type DockMarkTool = (typeof DOCK_MARK_TOOLS)[number];

export const DOCK_EVIDENCE_LIMITS = {
  images: 4,
  /** Finished or in-flight recordings per message; only one records at a time. */
  clips: 5,
  files: 10,
  marks: 99,
  clipMs: 120_000,
  penPoints: 256,
  elementText: 512,
  insertionText: 20_000,
  insertions: 16,
  /** Recently refused or removed mark ids remembered to settle late speech references. */
  retiredMarks: 64,
  /** Recently removed marks a text undo can bring back (chip deleted, then Cmd/Ctrl+Z). */
  removedMarks: 32,
} as const;

export interface DockImagePoint {
  x: number;
  y: number;
}
export interface DockImageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Image-pixel geometry of the capture the mark belongs to. */
export type DockMarkGeometry =
  | ({ kind: 'rect' } & DockImageRect)
  | { kind: 'path'; points: DockImagePoint[] }
  | { kind: 'arrow'; from: DockImagePoint; to: DockImagePoint };

export interface DockMarkElement {
  role: string;
  name: string;
  path: string | null;
  source: string | null;
}

export interface DockMark {
  id: string;
  imageId: string;
  tool: DockMarkTool;
  geometry: DockMarkGeometry;
  bounds: DockImageRect;
  element: DockMarkElement | null;
  createdAt: number;
  /** Offset into the recording that was live when the mark was made. */
  clipMs?: number;
  /** That recording's clip id (several clips can belong to one message). */
  clipId?: string;
  /** Offset into the active dictation, used to place its chip at the point of speech. */
  dictationOffsetMs?: number;
}

export interface DockEvidenceImage {
  id: string;
  /** Composer context item that holds the raw screenshot bytes. */
  contextItemId: string;
  width: number;
  height: number;
  displayScale: number;
  capturedAt: string;
  source: 'capture' | 'annotate' | 'dictation';
  hash?: string;
}

export type DockEvidenceErrorCode =
  'unavailable' | 'permission' | 'failed' | 'limit' | 'unsupported-workspace' | 'transport';

export interface DockEvidenceClip {
  id: string;
  status: 'recording' | 'placing' | 'ready' | 'failed';
  startedAt: number;
  durationMs: number;
  hasMicAudio: boolean;
  /** Composer file context item carrying the placed clip attachment. */
  contextItemId?: string;
  /**
   * Workspace-relative path the daemon returned for the placed attachment
   * (`.intent/attachments/...`). The only source for playback URLs; never a
   * native host path.
   */
  path?: string;
  error?: DockEvidenceErrorCode;
}

export type DockInsertionPart = { kind: 'text'; text: string } | { kind: 'mark'; markId: string };
/** One editor insertion with a durable identity; acknowledged once after commit. */
export interface DockEvidenceInsertion {
  id: string;
  parts: DockInsertionPart[];
}

export interface DockAnnotationSession {
  id: string;
  mode: 'live' | 'still' | 'dictation';
  /** Image receiving marks; null until the first live mark captures the screen. */
  imageId: string | null;
}

export interface DockDictationSession {
  id: string;
  startedAt: number;
  status: 'listening' | 'transcribing';
  /** Live, replace-in-place interim parts (rendered with a trailing ellipsis); never sent. */
  interim?: DockInsertionPart[];
}

export interface DockComposerEvidence {
  /** `JSON.stringify([workspaceId, agentId])`, matching the dock draft key. */
  id: string;
  images: DockEvidenceImage[];
  /** Creation order; `n = index + 1`. */
  marks: DockMark[];
  /** Recordings in start order; at most one has status `recording`. */
  clips: DockEvidenceClip[];
  /**
   * Queued in order. A mark part may name a native gesture id the evidence
   * channel has not delivered yet; it waits until that mark is accepted or
   * retired, and only the editor-ready prefix is exposed.
   */
  insertions: DockEvidenceInsertion[];
  /** Mark ids explicitly refused or removed (bounded, newest last; never persisted). */
  retiredMarkIds?: string[];
  /**
   * Marks removed one at a time with their creation index, so restoring the
   * chip (text undo, cut then paste) restores the mark and its number.
   * Bounded, newest last; never persisted.
   */
  removedMarks?: { index: number; mark: DockMark }[];
  /** Latest actionable annotate failure of the live session (never persisted). */
  annotationIssue?: DockAnnotationIssue | null;
  /** Undo/redo of the live annotate session's marks (never persisted). */
  annotationHistory?: DockAnnotationHistory | null;
  annotation: DockAnnotationSession | null;
  dictation: DockDictationSession | null;
  /** Resumable pre-admission placement progress per image (attachment refs and keys). */
  placements: Record<string, DockImagePlacementRecord>;
  /** `accepted` advances only when a capture actually added or replaced an image. */
  capture: { pending: boolean; error: DockEvidenceErrorCode | null; accepted: number };
  revision: number;
}

/**
 * One image's pre-admission placement: the burned composite, then (retention
 * daemons only) its raw original. Keys are stored before each request so a lost
 * reply is recovered by key on the next click. A record is reusable only for
 * the same composite content, workspace and backend.
 */
export interface DockImagePlacementRecord {
  imageId: string;
  signature: string;
  workspaceId: string;
  backendId: string | null;
  compositeKey: string | null;
  rawKey: string | null;
  composite: { attachmentId: string; mimeType: string } | null;
  /** Present only after the daemon echoed the association and a future deadline. */
  raw: { attachmentId: string; expiresAt: string } | null;
  /** Raw retention is definitively unavailable for this composite (expired, refused, unechoed). */
  rawSettled: boolean;
}

/** Composite identity: the image plus its numbered marks. Any change needs new keys. */
export function dockCompositeSignature(evidence: DockComposerEvidence, imageId: string): string {
  return JSON.stringify([
    imageId,
    numberDockMarks(evidence)
      .filter(({ mark }) => mark.imageId === imageId)
      .map(({ n, mark }) => [n, mark.id, mark.geometry]),
  ]);
}

/** A session image set aside by undo, with its screenshot bytes, so redo restores it. */
export interface DockParkedImage {
  image: DockEvidenceImage;
  item: { id: string; label: string; imageData: string; imageMimeType: string };
}

/**
 * Redo stack of one annotate session: each entry is a mark undo removed (newest
 * last), at its old creation index so redo gives it its old number. An entry also
 * holds the session image when that mark was its only one.
 */
interface DockAnnotationHistory {
  sessionId: string;
  redo: { index: number; mark: DockMark; image?: DockParkedImage }[];
}

/** Controlled editor chip reference; derived only, never persisted. */
export interface EditorScreenReference {
  id: string;
  number: number;
  label: string;
  /** Absent for a mark; a recording's start or end point in dictated text. */
  kind?: 'clip-start' | 'clip-end';
}

/** Speech-reference id for where recording `clipId` started or ended in dictated text. */
export function dockClipReferenceId(clipId: string, end: boolean): string {
  return `${end ? 'clip-end' : 'clip-start'}:${clipId}`;
}

/** Recordings that can be sent, numbered 1… in start order (failed ones have no number). */
function numberDockClips(
  evidence: Pick<DockComposerEvidence, 'clips'> | undefined,
): { n: number; clip: DockEvidenceClip }[] {
  return (evidence?.clips ?? [])
    .filter((clip) => clip.status !== 'failed')
    .map((clip, index) => ({ n: index + 1, clip }));
}

/** Every reference a text chip may name: marks, and each numbered recording's start and end. */
function liveReferenceIds(evidence: DockComposerEvidence): Set<string> {
  return new Set([
    ...evidence.marks.map((mark) => mark.id),
    ...numberDockClips(evidence).flatMap(({ clip }) => [
      dockClipReferenceId(clip.id, false),
      dockClipReferenceId(clip.id, true),
    ]),
  ]);
}

export function dockEvidenceId(workspaceId: string, agentId: string): string {
  return JSON.stringify([workspaceId, agentId]);
}

export function emptyDockEvidence(id: string): DockComposerEvidence {
  return {
    id,
    images: [],
    marks: [],
    clips: [],
    insertions: [],
    annotation: null,
    dictation: null,
    placements: {},
    capture: { pending: false, error: null, accepted: 0 },
    revision: 0,
  };
}

/** The clip recording now, if any. */
export function recordingDockClip(
  evidence: Pick<DockComposerEvidence, 'clips'> | undefined | null,
): DockEvidenceClip | null {
  return evidence?.clips.find((clip) => clip.status === 'recording') ?? null;
}

/** Context item ids of the message's clips (placed or being placed). */
export function dockClipItemIds(evidence: DockComposerEvidence | undefined | null): string[] {
  return (evidence?.clips ?? []).flatMap((clip) =>
    clip.contextItemId ? [clip.contextItemId] : [],
  );
}

/** Sendable evidence: any image, or a placed clip. */
export function hasDockEvidence(evidence: DockComposerEvidence | undefined): boolean {
  return (
    !!evidence &&
    (evidence.images.length > 0 || evidence.clips.some((clip) => clip.status === 'ready'))
  );
}

/**
 * Content identity of what a send carries. Session, capture-status and editor
 * insertion changes do not alter it, so they never block clearing an admitted draft.
 */
export function dockEvidenceFingerprint(evidence: DockComposerEvidence | undefined): string {
  return JSON.stringify([
    evidence?.images.map((image) => image.id) ?? [],
    evidence?.marks.map((mark) => mark.id) ?? [],
    evidence?.clips.map((clip) => [clip.id, clip.status]) ?? [],
  ]);
}

/** Context item ids whose bytes the composer must not send raw (images are burned at send). */
export function dockEvidenceImageItemIds(evidence: DockComposerEvidence | undefined): Set<string> {
  return new Set(evidence?.images.map((image) => image.contextItemId) ?? []);
}

export function numberDockMarks(evidence: DockComposerEvidence): { n: number; mark: DockMark }[] {
  return evidence.marks.map((mark, index) => ({ n: index + 1, mark }));
}

export function screenReferences(
  evidence: DockComposerEvidence | undefined,
  toolLabels: Readonly<Record<DockMarkTool, string>>,
  /** Caller-localized chip text for where recording `n` started (`end` false) or ended. */
  recordingLabel?: (n: number, end: boolean) => string,
): EditorScreenReference[] {
  return [
    ...(evidence?.marks ?? []).map((mark, index) => ({
      id: mark.id,
      number: index + 1,
      label: mark.element?.name || toolLabels[mark.tool],
    })),
    ...numberDockClips(evidence).flatMap(({ n, clip }) =>
      [false, true].map((end): EditorScreenReference => ({
        id: dockClipReferenceId(clip.id, end),
        number: n,
        label: recordingLabel?.(n, end) ?? '',
        kind: end ? 'clip-end' : 'clip-start',
      })),
    ),
  ];
}

/**
 * The first live mark of a session reuses the newest image when it has no
 * marks, the same size, and the screen has not changed (difference-hash
 * distance within the threshold). Without two hashes an unchanged screen
 * cannot be shown, so a new image is taken.
 */
export function reusableDockImage(
  evidence: DockComposerEvidence,
  capture: Pick<DockCapturedPixels, 'width' | 'height' | 'hash'>,
): DockEvidenceImage | null {
  const newest = evidence.images.at(-1);
  if (
    !newest ||
    evidence.marks.some((mark) => mark.imageId === newest.id) ||
    newest.width !== capture.width ||
    newest.height !== capture.height
  )
    return null;
  return dockHashDistance(newest.hash, capture.hash) <= DOCK_ANNOTATION_LIMITS.hashThreshold
    ? newest
    : null;
}

/** Capture is refused only when four images exist and every one carries marks. */
export function dockCaptureDisabled(evidence: DockComposerEvidence | undefined): boolean {
  if (!evidence || evidence.images.length < DOCK_EVIDENCE_LIMITS.images) return false;
  return evidence.images.every((image) => evidence.marks.some((m) => m.imageId === image.id));
}

// ---------------------------------------------------------------------------
// Bounded inputs
// ---------------------------------------------------------------------------

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function boundedText(value: unknown, max: number = DOCK_EVIDENCE_LIMITS.elementText): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function clampPoint(point: DockImagePoint, image: DockEvidenceImage): DockImagePoint | null {
  if (!point || !finite(point.x) || !finite(point.y)) return null;
  return {
    x: Math.min(image.width, Math.max(0, point.x)),
    y: Math.min(image.height, Math.max(0, point.y)),
  };
}

function rectOf(points: DockImagePoint[]): DockImageRect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function sanitizeGeometry(
  geometry: DockMarkGeometry,
  image: DockEvidenceImage,
): DockMarkGeometry | null {
  if (!geometry || typeof geometry !== 'object') return null;
  if (geometry.kind === 'rect') {
    if (![geometry.x, geometry.y, geometry.w, geometry.h].every(finite)) return null;
    const from = clampPoint(
      {
        x: Math.min(geometry.x, geometry.x + geometry.w),
        y: Math.min(geometry.y, geometry.y + geometry.h),
      },
      image,
    );
    const to = clampPoint(
      {
        x: Math.max(geometry.x, geometry.x + geometry.w),
        y: Math.max(geometry.y, geometry.y + geometry.h),
      },
      image,
    );
    if (!from || !to) return null;
    return { kind: 'rect', x: from.x, y: from.y, w: to.x - from.x, h: to.y - from.y };
  }
  if (geometry.kind === 'arrow') {
    const from = clampPoint(geometry.from, image);
    const to = clampPoint(geometry.to, image);
    return from && to ? { kind: 'arrow', from, to } : null;
  }
  if (geometry.kind === 'path' && Array.isArray(geometry.points)) {
    const points = geometry.points
      .map((point) => clampPoint(point, image))
      .filter((point): point is DockImagePoint => !!point);
    if (!points.length) return null;
    // Keep the shape's ends while bounding long freehand strokes.
    const stride = Math.ceil(points.length / DOCK_EVIDENCE_LIMITS.penPoints);
    const bounded = points.filter((_, index) => index % stride === 0);
    if (bounded.at(-1) !== points.at(-1)) bounded.push(points.at(-1)!);
    return { kind: 'path', points: bounded.slice(-DOCK_EVIDENCE_LIMITS.penPoints) };
  }
  return null;
}

export function dockGeometryBounds(geometry: DockMarkGeometry): DockImageRect {
  if (geometry.kind === 'rect')
    return { x: geometry.x, y: geometry.y, w: geometry.w, h: geometry.h };
  return rectOf(geometry.kind === 'path' ? geometry.points : [geometry.from, geometry.to]);
}

function sanitizeElement(element: DockMarkElement | null | undefined): DockMarkElement | null {
  if (!element || typeof element !== 'object') return null;
  const name = boundedText(element.name);
  const role = boundedText(element.role);
  if (!name && !role) return null;
  return {
    role,
    name,
    path: element.path ? boundedText(element.path) : null,
    source: element.source ? boundedText(element.source) : null,
  };
}

/** Clamp a mark to its image and bound every free-form field; null when unusable. */
export function sanitizeDockMark(mark: DockMark, image: DockEvidenceImage): DockMark | null {
  if (!mark || typeof mark.id !== 'string' || !mark.id || mark.imageId !== image.id) return null;
  if (!(DOCK_MARK_TOOLS as readonly string[]).includes(mark.tool)) return null;
  const geometry = sanitizeGeometry(mark.geometry, image);
  if (!geometry) return null;
  return {
    id: mark.id,
    imageId: image.id,
    tool: mark.tool,
    geometry,
    bounds: dockGeometryBounds(geometry),
    element: sanitizeElement(mark.element),
    createdAt: finite(mark.createdAt) ? mark.createdAt : 0,
    ...(finite(mark.clipMs) && mark.clipMs >= 0 ? { clipMs: Math.round(mark.clipMs) } : {}),
    ...(typeof mark.clipId === 'string' && mark.clipId && mark.clipId.length <= 128
      ? { clipId: mark.clipId }
      : {}),
    ...(finite(mark.dictationOffsetMs) && mark.dictationOffsetMs >= 0
      ? { dictationOffsetMs: Math.round(mark.dictationOffsetMs) }
      : {}),
  };
}

function validImage(image: DockEvidenceImage): boolean {
  return (
    !!image &&
    typeof image.id === 'string' &&
    !!image.id &&
    typeof image.contextItemId === 'string' &&
    !!image.contextItemId &&
    finite(image.width) &&
    finite(image.height) &&
    image.width > 0 &&
    image.height > 0 &&
    finite(image.displayScale) &&
    image.displayScale > 0 &&
    typeof image.capturedAt === 'string' &&
    ['capture', 'annotate', 'dictation'].includes(image.source)
  );
}

// ---------------------------------------------------------------------------
// Transitions (each returns a new value and advances `revision` on change)
// ---------------------------------------------------------------------------

function changed(
  evidence: DockComposerEvidence,
  patch: Partial<DockComposerEvidence>,
): DockComposerEvidence {
  return { ...evidence, ...patch, revision: evidence.revision + 1 };
}

/** Drop mark parts naming retired marks, then any insertion left empty. Spoken text stays. */
function pruneInsertions(
  insertions: DockEvidenceInsertion[],
  retired: ReadonlySet<string>,
): DockEvidenceInsertion[] {
  return insertions
    .map((insertion) => ({
      ...insertion,
      parts: insertion.parts.filter((part) => part.kind === 'text' || !retired.has(part.markId)),
    }))
    .filter((insertion) => insertion.parts.length > 0);
}

/** Remember retired ids (bounded) and strip exactly those references from queued insertions. */
function retireMarks(
  evidence: DockComposerEvidence,
  ids: readonly string[],
): Pick<DockComposerEvidence, 'retiredMarkIds' | 'insertions'> {
  const retired = new Set(ids);
  return {
    retiredMarkIds: [
      ...(evidence.retiredMarkIds ?? []).filter((id) => !retired.has(id)),
      ...retired,
    ].slice(-DOCK_EVIDENCE_LIMITS.retiredMarks),
    insertions: pruneInsertions(evidence.insertions, retired),
  };
}

/**
 * Explicit settlement for a native gesture id the renderer refused (capture
 * limit, invalid mark, ended session). Only that reference is dropped from
 * queued narration; an accepted mark is never retired this way.
 */
export function rejectDockMark(
  evidence: DockComposerEvidence,
  markId: string,
): DockComposerEvidence {
  if (typeof markId !== 'string' || !markId || evidence.marks.some((mark) => mark.id === markId))
    return evidence;
  if (evidence.retiredMarkIds?.includes(markId)) return evidence;
  return changed(evidence, retireMarks(evidence, [markId]));
}

/** The in-order prefix of insertions whose every mark part names an accepted mark. */
export function readyDockInsertions(evidence: DockComposerEvidence): DockEvidenceInsertion[] {
  const live = liveReferenceIds(evidence);
  const ready: DockEvidenceInsertion[] = [];
  for (const insertion of evidence.insertions) {
    if (insertion.parts.some((part) => part.kind === 'mark' && !live.has(part.markId))) break;
    ready.push(insertion);
  }
  return ready;
}

export type DockCaptureOutcome =
  | { outcome: 'added'; evidence: DockComposerEvidence }
  | { outcome: 'replaced'; evidence: DockComposerEvidence; replaced: DockEvidenceImage }
  | { outcome: 'limit' | 'invalid'; evidence: DockComposerEvidence };

/** A fifth image replaces the oldest unmarked one; when all are marked, capture is refused. */
export function applyDockCapture(
  evidence: DockComposerEvidence,
  image: DockEvidenceImage,
): DockCaptureOutcome {
  if (!validImage(image) || evidence.images.some((row) => row.id === image.id))
    return { outcome: 'invalid', evidence };
  if (evidence.images.length < DOCK_EVIDENCE_LIMITS.images)
    return {
      outcome: 'added',
      evidence: changed(evidence, { images: [...evidence.images, image] }),
    };
  const replaced = evidence.images.find(
    (row) => !evidence.marks.some((mark) => mark.imageId === row.id),
  );
  if (!replaced) return { outcome: 'limit', evidence };
  return {
    outcome: 'replaced',
    replaced,
    evidence: changed(evidence, {
      images: [...evidence.images.filter((row) => row.id !== replaced.id), image],
      annotation:
        evidence.annotation?.imageId === replaced.id
          ? { ...evidence.annotation, imageId: null }
          : evidence.annotation,
    }),
  };
}

/** Removing an image removes its marks (and their pending chips); later marks renumber. */
export function removeDockImage(
  evidence: DockComposerEvidence,
  imageId: string,
): DockComposerEvidence {
  if (!evidence.images.some((image) => image.id === imageId)) return evidence;
  const marks = evidence.marks.filter((mark) => mark.imageId !== imageId);
  const removed = evidence.marks.filter((mark) => mark.imageId === imageId).map((mark) => mark.id);
  const placements = { ...evidence.placements };
  delete placements[imageId];
  return changed(evidence, {
    images: evidence.images.filter((image) => image.id !== imageId),
    marks,
    placements,
    removedMarks: evidence.removedMarks?.filter(({ mark }) => mark.imageId !== imageId),
    ...retireMarks(evidence, removed),
    annotation:
      evidence.annotation?.imageId === imageId
        ? { ...evidence.annotation, imageId: null }
        : evidence.annotation,
  });
}

export function addDockMark(
  evidence: DockComposerEvidence,
  mark: DockMark,
): { accepted: boolean; evidence: DockComposerEvidence } {
  const image = evidence.images.find((row) => row.id === mark?.imageId);
  if (
    !image ||
    evidence.marks.length >= DOCK_EVIDENCE_LIMITS.marks ||
    evidence.marks.some((row) => row.id === mark.id)
  )
    return { accepted: false, evidence };
  const sanitized = sanitizeDockMark(mark, image);
  if (!sanitized) return { accepted: false, evidence };
  return { accepted: true, evidence: changed(evidence, { marks: [...evidence.marks, sanitized] }) };
}

export function removeDockMark(
  evidence: DockComposerEvidence,
  markId: string,
): DockComposerEvidence {
  const index = evidence.marks.findIndex((mark) => mark.id === markId);
  if (index < 0) return evidence;
  const marks = evidence.marks.filter((mark) => mark.id !== markId);
  return changed(evidence, {
    marks,
    ...retireMarks(evidence, [markId]),
    removedMarks: [
      ...(evidence.removedMarks ?? []).filter(({ mark }) => mark.id !== markId),
      { index, mark: evidence.marks[index] },
    ].slice(-DOCK_EVIDENCE_LIMITS.removedMarks),
  });
}

/**
 * Bring back a mark removed with its chip when the chip reappears in the text
 * (undo, paste). It returns at its old creation index, so it gets its old
 * number back and later marks shift. No-op when the mark is unknown, already
 * present, its image is gone, or the mark limit is reached.
 */
function restoreDockMark(evidence: DockComposerEvidence, markId: string): DockComposerEvidence {
  const removed = evidence.removedMarks?.find(({ mark }) => mark.id === markId);
  if (
    !removed ||
    evidence.marks.some((mark) => mark.id === markId) ||
    !evidence.images.some((image) => image.id === removed.mark.imageId) ||
    evidence.marks.length >= DOCK_EVIDENCE_LIMITS.marks
  )
    return evidence;
  const marks = [...evidence.marks];
  marks.splice(Math.min(removed.index, marks.length), 0, removed.mark);
  return changed(evidence, {
    marks,
    retiredMarkIds: evidence.retiredMarkIds?.filter((id) => id !== markId),
    removedMarks: evidence.removedMarks?.filter(({ mark }) => mark.id !== markId),
  });
}

/** Chips a user edit took out of or put back into the text, by mark id. */
export interface DockReferenceEdit {
  removed: string[];
  restored: string[];
}

/**
 * Marks are the join between text and images: a chip deleted from the text
 * removes its mark (later marks renumber everywhere); a chip that comes back
 * (undo, paste) restores its mark and number. Restores run newest removal
 * first so several chips removed by one edit return to their old numbers.
 */
export function applyDockReferenceEdit(
  evidence: DockComposerEvidence,
  edit: DockReferenceEdit,
): DockComposerEvidence {
  let next = evidence;
  for (const id of edit.removed) next = removeDockMark(next, id);
  const order = (id: string) => next.removedMarks?.findIndex(({ mark }) => mark.id === id) ?? -1;
  for (const id of [...edit.restored].sort((a, b) => order(b) - order(a)))
    next = restoreDockMark(next, id);
  return next;
}

/** The live annotate session's newest mark on its not-yet-attached image, if any. */
export function undoableDockMark(evidence: DockComposerEvidence | undefined): DockMark | null {
  const session = evidence?.annotation;
  if (!evidence || !session?.imageId || session.mode === 'dictation') return null;
  return [...evidence.marks].reverse().find((mark) => mark.imageId === session.imageId) ?? null;
}

/** Whether redo has something for the open session. */
export function redoableDockMark(evidence: DockComposerEvidence | undefined): boolean {
  const history = evidence?.annotationHistory;
  return !!history?.redo.length && history.sessionId === evidence?.annotation?.id;
}

/**
 * Undo the session's newest mark (number, chip). When it was the only mark on a
 * live session image, the image goes too and is parked for redo. `parked` carries
 * that image's bytes (the caller owns the composer context item).
 */
export function undoDockAnnotationMark(
  evidence: DockComposerEvidence,
  parked?: DockParkedImage,
): DockComposerEvidence {
  const session = evidence.annotation;
  const mark = undoableDockMark(evidence);
  if (!session || !mark) return evidence;
  const index = evidence.marks.findIndex((row) => row.id === mark.id);
  const lastOnImage =
    session.mode === 'live' &&
    !evidence.marks.some((row) => row.imageId === mark.imageId && row !== mark);
  const image = lastOnImage && parked?.image.id === mark.imageId ? parked : undefined;
  let next = removeDockMark(evidence, mark.id);
  if (image) next = removeDockImage(next, image.image.id);
  const history =
    evidence.annotationHistory?.sessionId === session.id ? evidence.annotationHistory.redo : [];
  return changed(next, {
    annotationHistory: {
      sessionId: session.id,
      redo: [...history, { index, mark, ...(image ? { image } : {}) }],
    },
  });
}

/**
 * Redo the newest undone mark with its old number, element and capture; a parked
 * image comes back first (and becomes the session image). Refused, unchanged, when
 * the image no longer fits (screenshot limit) or is gone.
 */
export function redoDockAnnotationMark(evidence: DockComposerEvidence): DockComposerEvidence {
  if (!redoableDockMark(evidence)) return evidence;
  const history = evidence.annotationHistory!;
  const entry = history.redo.at(-1)!;
  let next = evidence;
  if (entry.image) {
    const captured = applyDockCapture(next, entry.image.image);
    if (captured.outcome !== 'added') return evidence;
    next = {
      ...captured.evidence,
      annotation: { ...next.annotation!, imageId: entry.image.image.id },
    };
  }
  if (!next.images.some((image) => image.id === entry.mark.imageId)) return evidence;
  if (next.marks.some((mark) => mark.id === entry.mark.id)) return evidence;
  const marks = [...next.marks];
  marks.splice(Math.min(entry.index, marks.length), 0, entry.mark);
  return changed(next, {
    marks,
    retiredMarkIds: next.retiredMarkIds?.filter((id) => id !== entry.mark.id),
    removedMarks: next.removedMarks?.filter(({ mark }) => mark.id !== entry.mark.id),
    annotationHistory: { ...history, redo: history.redo.slice(0, -1) },
  });
}

/** The parked image the session's overlay still shows, if undo took the session image. */
export function parkedDockSessionImage(
  evidence: DockComposerEvidence | undefined,
): DockParkedImage | null {
  const history = evidence?.annotationHistory;
  if (!history || history.sessionId !== evidence?.annotation?.id || evidence.annotation.imageId)
    return null;
  return [...history.redo].reverse().find((entry) => entry.image)?.image ?? null;
}

export function undoDockMark(evidence: DockComposerEvidence): DockComposerEvidence {
  const last = evidence.marks.at(-1);
  return last ? removeDockMark(evidence, last.id) : evidence;
}

/**
 * Queue one editor insertion. Accepted marks and not-yet-delivered native
 * gesture ids are kept (the latter wait for explicit settlement); retired
 * marks and unbounded text are dropped.
 */
export function enqueueDockInsertion(
  evidence: DockComposerEvidence,
  insertion: DockEvidenceInsertion,
): DockComposerEvidence {
  if (
    !insertion ||
    typeof insertion.id !== 'string' ||
    !insertion.id ||
    evidence.insertions.some((row) => row.id === insertion.id) ||
    evidence.insertions.length >= DOCK_EVIDENCE_LIMITS.insertions ||
    !Array.isArray(insertion.parts)
  )
    return evidence;
  const retired = new Set(evidence.retiredMarkIds ?? []);
  let budget: number = DOCK_EVIDENCE_LIMITS.insertionText;
  const parts: DockInsertionPart[] = [];
  for (const part of insertion.parts) {
    if (
      part?.kind === 'mark' &&
      typeof part.markId === 'string' &&
      part.markId &&
      part.markId.length <= 128 &&
      !retired.has(part.markId)
    )
      parts.push({ kind: 'mark', markId: part.markId });
    else if (part?.kind === 'text' && typeof part.text === 'string' && part.text && budget > 0) {
      const text = part.text.slice(0, budget);
      budget -= text.length;
      parts.push({ kind: 'text', text });
    }
  }
  if (!parts.length) return evidence;
  return changed(evidence, { insertions: [...evidence.insertions, { id: insertion.id, parts }] });
}

/** Bound live interim parts to the same text budget as committed insertions. */
export function boundDockInterim(
  evidence: DockComposerEvidence,
  parts: readonly DockInsertionPart[],
): DockInsertionPart[] {
  const live = liveReferenceIds(evidence);
  let budget: number = DOCK_EVIDENCE_LIMITS.insertionText;
  const out: DockInsertionPart[] = [];
  for (const part of parts) {
    if (part?.kind === 'mark' && live.has(part.markId))
      out.push({ kind: 'mark', markId: part.markId });
    else if (part?.kind === 'text' && typeof part.text === 'string' && part.text && budget > 0) {
      const text = part.text.slice(0, budget);
      budget -= text.length;
      out.push({ kind: 'text', text });
    }
  }
  return out;
}

/** Idempotent: an unknown or already-applied insertion is a no-op. */
export function ackDockInsertion(
  evidence: DockComposerEvidence,
  insertionId: string,
): DockComposerEvidence {
  if (!evidence.insertions.some((row) => row.id === insertionId)) return evidence;
  return changed(evidence, {
    insertions: evidence.insertions.filter((row) => row.id !== insertionId),
  });
}

/**
 * Add or update one clip by id (new clips append in start order, up to the
 * limit); null removes it. Marks keep their clip time; the wire drops times
 * for clips that are gone.
 */
export function setDockClip(
  evidence: DockComposerEvidence,
  clipId: string,
  clip: DockEvidenceClip | null,
): DockComposerEvidence {
  const index = evidence.clips.findIndex((row) => row.id === clipId);
  // A removed or failed recording takes its start/end chips out of queued speech too.
  const references = [dockClipReferenceId(clipId, false), dockClipReferenceId(clipId, true)];
  if (!clip) {
    if (index < 0) return evidence;
    return changed(evidence, {
      clips: evidence.clips.filter((row) => row.id !== clipId),
      ...retireMarks(evidence, references),
    });
  }
  if (clip.id !== clipId) return evidence;
  if (index >= 0)
    return changed(evidence, {
      clips: evidence.clips.map((row, at) => (at === index ? clip : row)),
      ...(clip.status === 'failed' ? retireMarks(evidence, references) : {}),
    });
  if (evidence.clips.length >= DOCK_EVIDENCE_LIMITS.clips) return evidence;
  return changed(evidence, { clips: [...evidence.clips, clip] });
}

export function patchDockEvidence(
  evidence: DockComposerEvidence,
  patch: Partial<
    Pick<
      DockComposerEvidence,
      | 'annotation'
      | 'annotationIssue'
      | 'annotationHistory'
      | 'dictation'
      | 'capture'
      | 'placements'
    >
  >,
): DockComposerEvidence {
  return changed(evidence, patch);
}

// ---------------------------------------------------------------------------
// Wire projection (user-space `messageMetadata`, PROTOCOL agent.sendMessage)
// ---------------------------------------------------------------------------

const MARK_TOKEN = /\[\[mark:(\d+)\]\]/g;
const CLIP_TOKEN = /\[\[clip:(\d+)(?::end)?\]\]/g;

/** Every `[[mark:n]]` names an existing mark and every `[[clip:n]]` / `[[clip:n:end]]` a recording. */
export function validDockWireTokens(
  text: string,
  evidence: DockComposerEvidence | undefined,
): boolean {
  const within = (token: RegExp, count: number) =>
    [...text.matchAll(token)].every((match) => {
      const n = Number(match[1]);
      return Number.isSafeInteger(n) && n >= 1 && n <= count;
    });
  return (
    within(MARK_TOKEN, evidence?.marks.length ?? 0) &&
    within(CLIP_TOKEN, numberDockClips(evidence).length)
  );
}

/** Wire geometry: integer image pixels; freehand strokes simplified to a bounded point count. */
type DockWireGeometry =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'path'; points: [number, number][] }
  | { kind: 'arrow'; tail: [number, number]; head: [number, number] };

export interface DockScreenEvidenceMetadata {
  type: 'dock_screen_evidence';
  version: 1;
  images: {
    /** Position among the message's screenshot image blocks (they lead the image blocks). */
    index: number;
    id: string;
    /** Placed composite reference; null when sent inline (assistant workspace). */
    attachment_id: string | null;
    /** Raw original retained by the daemon until `expires_at` (server-fixed); null otherwise. */
    raw: { attachment_id: string; expires_at: string } | null;
    width: number;
    height: number;
    display_scale: number;
    captured_at: string;
    marks: {
      n: number;
      id: string;
      tool: DockMarkTool;
      rect: DockImageRect;
      geometry: DockWireGeometry;
      element: DockMarkElement | null;
    }[];
  }[];
  /** Finished recordings in start order. */
  clips?: {
    id: string;
    /** Attachment registry reference of the placed clip file. */
    attachment_id: string | null;
    duration_ms: number;
    has_mic_audio: boolean;
    mark_timestamps_ms: Record<string, number>;
  }[];
  context: { workspace: string; agent: string; app_url: string };
}

/** Bounded wire sizes: metadata keeps detailed strokes; the agent-readable copy stays compact. */
export const DOCK_WIRE_PEN_POINTS = { metadata: 64, context: 16 } as const;

const roundRect = (rect: DockImageRect): DockImageRect => ({
  x: Math.round(rect.x),
  y: Math.round(rect.y),
  w: Math.round(rect.w),
  h: Math.round(rect.h),
});
const pair = (point: DockImagePoint): [number, number] => [
  Math.round(point.x),
  Math.round(point.y),
];

function toDockWireGeometry(geometry: DockMarkGeometry, maxPoints: number): DockWireGeometry {
  if (geometry.kind === 'rect') return { kind: 'rect', ...roundRect(geometry) };
  if (geometry.kind === 'arrow')
    return { kind: 'arrow', tail: pair(geometry.from), head: pair(geometry.to) };
  const points = geometry.points;
  const stride = Math.max(1, Math.ceil(points.length / Math.max(2, maxPoints)));
  const kept = points.filter((_, index) => index % stride === 0);
  if (kept.at(-1) !== points.at(-1)) kept.push(points.at(-1)!);
  return { kind: 'path', points: kept.slice(-Math.max(2, maxPoints)).map(pair) };
}

/** Images in tile order (index matches the leading screenshot image blocks); marks keep message numbers. */
export function buildDockEvidenceMetadata(
  evidence: DockComposerEvidence,
  context: {
    workspaceId: string;
    agentId: string;
    appUrl: string;
    /** Placed clip attachment ids by clip id, when the clips ride as file blocks. */
    clipAttachmentIds?: Readonly<Record<string, string | null>>;
    /** Pre-placed composites and verified raw retention, by image id. */
    imageAttachments?: Readonly<
      Record<
        string,
        { attachmentId: string; raw: { attachmentId: string; expiresAt: string } | null }
      >
    >;
  },
  maxPenPoints: number = DOCK_WIRE_PEN_POINTS.metadata,
): DockScreenEvidenceMetadata {
  const numbered = numberDockMarks(evidence);
  const clips = evidence.clips.filter((clip) => clip.status === 'ready');
  return {
    type: 'dock_screen_evidence',
    version: 1,
    images: evidence.images.map((image, index) => ({
      index,
      id: image.id,
      attachment_id: context.imageAttachments?.[image.id]?.attachmentId ?? null,
      raw: context.imageAttachments?.[image.id]?.raw
        ? {
            attachment_id: context.imageAttachments[image.id].raw!.attachmentId,
            expires_at: context.imageAttachments[image.id].raw!.expiresAt,
          }
        : null,
      width: image.width,
      height: image.height,
      display_scale: image.displayScale,
      captured_at: image.capturedAt,
      marks: numbered
        .filter(({ mark }) => mark.imageId === image.id)
        .map(({ n, mark }) => ({
          n,
          id: mark.id,
          tool: mark.tool,
          rect: roundRect(mark.bounds),
          geometry: toDockWireGeometry(mark.geometry, maxPenPoints),
          element: mark.element,
        })),
    })),
    ...(clips.length
      ? {
          clips: clips.map((clip) => ({
            id: clip.id,
            attachment_id: context.clipAttachmentIds?.[clip.id] ?? null,
            duration_ms: Math.round(clip.durationMs),
            has_mic_audio: clip.hasMicAudio,
            mark_timestamps_ms: Object.fromEntries(
              numbered
                .filter(({ mark }) => mark.clipMs !== undefined && mark.clipId === clip.id)
                .map(({ n, mark }) => [String(n), mark.clipMs!]),
            ),
          })),
        }
      : {}),
    context: { workspace: context.workspaceId, agent: context.agentId, app_url: context.appUrl },
  };
}

/** Opening line of the agent-readable evidence block in the message's context prefix. */
export const DOCK_EVIDENCE_CONTEXT_HEADER =
  // i18n-ignore (agent-directed context marker, not user-facing UI)
  '[Screen evidence: screenshots lead the attached images in this order; [[mark:n]] in the message refers to mark n; [[clip:n]] and [[clip:n:end]] mark where recording n started and stopped while the user was speaking]';

/**
 * Agent-readable copy of the evidence for the content prefix (models may never
 * see `messageMetadata`). Compact JSON of what the user marked, with no user
 * text or chip duplication; stroke detail is reduced to stay small.
 */
export function buildDockEvidenceContext(
  evidence: DockComposerEvidence,
  context: Parameters<typeof buildDockEvidenceMetadata>[1],
): string {
  const { images, clips } = buildDockEvidenceMetadata(
    evidence,
    context,
    DOCK_WIRE_PEN_POINTS.context,
  );
  const body = {
    type: 'dock_screen_evidence' as const,
    version: 1 as const,
    images: images.map(({ index, attachment_id, raw, width, height, display_scale, marks }) => ({
      image: index + 1,
      attachment_id,
      ...(raw ? { raw } : {}),
      size: [width, height],
      scale: display_scale,
      marks: marks.map(({ n, tool, geometry, element }) => ({
        n,
        tool,
        geometry,
        ...(element ? { element } : {}),
      })),
    })),
    ...(clips?.length
      ? {
          clips: clips.map((clip, index) => ({
            clip: index + 1,
            attachment_id: clip.attachment_id,
            duration_ms: clip.duration_ms,
            has_mic_audio: clip.has_mic_audio,
            mark_timestamps_ms: clip.mark_timestamps_ms,
          })),
        }
      : {}),
  };
  return `${DOCK_EVIDENCE_CONTEXT_HEADER}\n\`\`\`json\n${JSON.stringify(body)}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// Draft persistence (FE-owned opaque `drafts.set` attachments)
// ---------------------------------------------------------------------------

export type DockDraftEvidence =
  | {
      kind: 'image';
      image: Omit<DockEvidenceImage, 'contextItemId'>;
      /** Message-wide creation index keeps numbering across images on restore. */
      marks: { index: number; mark: DockMark }[];
    }
  | { kind: 'clip'; clip: Omit<DockEvidenceClip, 'contextItemId' | 'status' | 'error'> };

/** A safe workspace-relative attachment path: relative, no dot segments, bounded. */
export function isDockAttachmentPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 1024) return false;
  if (value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every((segment) => !!segment && segment !== '.' && segment !== '..');
}

/** Per context item draft evidence; runtime sessions and insertions are never persisted. */
export function toDockDraftEvidence(
  evidence: DockComposerEvidence | undefined,
): Record<string, DockDraftEvidence> {
  if (!evidence) return {};
  const out: Record<string, DockDraftEvidence> = {};
  for (const { contextItemId, ...image } of evidence.images)
    out[contextItemId] = {
      kind: 'image',
      image,
      marks: evidence.marks
        .map((mark, index) => ({ index, mark }))
        .filter(({ mark }) => mark.imageId === image.id),
    };
  for (const clip of evidence.clips) {
    if (clip.status !== 'ready' || !clip.contextItemId) continue;
    out[clip.contextItemId] = {
      kind: 'clip',
      clip: {
        id: clip.id,
        startedAt: clip.startedAt,
        durationMs: clip.durationMs,
        hasMicAudio: clip.hasMicAudio,
        ...(clip.path ? { path: clip.path } : {}),
      },
    };
  }
  return out;
}

/** Rebuild evidence for restored items that still exist, validating every field. */
export function fromDockDraftEvidence(
  id: string,
  entries: ReadonlyArray<readonly [contextItemId: string, entry: unknown]>,
): DockComposerEvidence {
  let evidence = emptyDockEvidence(id);
  const marks: { index: number; mark: DockMark }[] = [];
  for (const [contextItemId, entry] of entries) {
    const value = entry as DockDraftEvidence | null;
    if (!value || typeof value !== 'object') continue;
    if (value.kind === 'image' && value.image) {
      const captured = applyDockCapture(evidence, { ...value.image, contextItemId });
      if (captured.outcome !== 'added') continue;
      evidence = captured.evidence;
      if (Array.isArray(value.marks))
        for (const row of value.marks) if (row && finite(row.index)) marks.push(row);
    } else if (value.kind === 'clip' && value.clip) {
      const clip = value.clip;
      if (typeof clip.id !== 'string' || !clip.id || !finite(clip.durationMs)) continue;
      evidence = setDockClip(evidence, clip.id, {
        id: clip.id,
        status: 'ready',
        startedAt: finite(clip.startedAt) ? clip.startedAt : 0,
        durationMs: Math.min(DOCK_EVIDENCE_LIMITS.clipMs, Math.max(0, clip.durationMs)),
        hasMicAudio: clip.hasMicAudio === true,
        contextItemId,
        ...(isDockAttachmentPath(clip.path) ? { path: clip.path } : {}),
      });
    }
  }
  for (const { mark } of marks.sort((a, b) => a.index - b.index))
    evidence = addDockMark(evidence, mark).evidence;
  return { ...evidence, revision: 0 };
}

// ---------------------------------------------------------------------------
// Native boundary (implemented by the dock window's main/native owner)
// ---------------------------------------------------------------------------

/** Screenshot of the display the dock is on, with the dock excluded. */
export interface DockCapturedPixels {
  /** Base64 bytes without a data-URL prefix. */
  base64: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  displayScale: number;
  capturedAt: string;
  /** 16×16 difference hash (hex) when native computed it. */
  hash?: string;
  /**
   * Native-owned identity for this capture. When present the renderer keeps its
   * `id`/`contextItemId`, and a repeat of an already-present id is idempotent.
   */
  image?: DockEvidenceImage;
}

/**
 * Server capabilities observed from the acknowledged hello of one backend
 * connection. Valid only while that connection (backend id + generation) is
 * still the window's current one.
 */
export interface DockServerCapabilities {
  backendId: string | null;
  generation: number;
  /** `rawScreenshotRetention === 1`. */
  rawRetention: boolean;
  /** `chiefAttachments === 1`: the assistant workspace has an attachment registry. */
  chiefAttachments: boolean;
}

/** Native capability snapshot; disabled controls stay honest until an owner implements them. */
export interface DockEvidenceCapabilities {
  capture: boolean;
  annotate: boolean;
  record: boolean;
}

/** A finished clip written by native to a host path, ready for attachment placement. */
export interface DockClipFile {
  sourcePath: string;
  mimeType: string;
  size: number;
  durationMs: number;
  hasMicAudio: boolean;
}

export type DockNativeResult<T> =
  { ok: true; value: T } | { ok: false; error: DockEvidenceErrorCode; detail?: string };

export type DockEvidenceNativeEvent =
  | {
      type: 'mark';
      sessionId: string;
      tool: DockMarkTool;
      /** In pixels of `capture` when present, otherwise of the session image. */
      geometry: DockMarkGeometry;
      element: DockMarkElement | null;
      /** Present for the first live mark, or when the screen changed under the session. */
      capture?: DockCapturedPixels;
      /** Elapsed clip time when a recording is live. */
      clipMs?: number;
      /**
       * Stable mark id minted by native at gesture start. When present the
       * renderer adopts it, and native stamps any live speech/clip clock with it
       * at the real click time (the renderer then does not re-stamp).
       */
      markId?: string;
      /** Epoch ms of the gesture start, for point-of-speech offsets. */
      gestureAtEpochMs?: number;
    }
  | { type: 'annotation-ended'; sessionId: string }
  /** The tool was switched on the overlay's on-screen tool bar. */
  | { type: 'annotation-tool'; sessionId: string; tool: DockMarkTool }
  /**
   * Done on the tool bar: the current marks stay on their image in the composer and
   * the screen is cleared; the next mark starts a new image. The session stays open.
   */
  | { type: 'annotation-commit'; sessionId: string }
  /** Clear on the tool bar: the current marks (and a live session's image) are dropped. */
  | { type: 'annotation-clear'; sessionId: string }
  /** Screenshot or Record on the tool bar: the dock runs the composer's own action. */
  | { type: 'annotation-media'; sessionId: string; action: 'capture' | 'record' }
  /**
   * A genuine failure in a live session (no capture taken, no mark made): `pick`
   * means accessibility metadata is unreadable, `target`/`capture` that the screen
   * could not be checked or captured. Shape of main's `DockAnnotationIssue`.
   */
  | ({ type: 'annotation-issue' } & DockAnnotationIssue)
  | { type: 'clip-ended'; clipId: string; result: DockNativeResult<DockClipFile> };

export interface DockEvidenceNativeService {
  /** Absent means only `captureDisplay` is implemented (annotate and record stay disabled). */
  readonly capabilities?: DockEvidenceCapabilities;
  captureDisplay(): Promise<DockNativeResult<DockCapturedPixels>>;
  /** `still` annotates an existing image instead of the live screen. */
  startAnnotation(session: {
    id: string;
    tool: DockMarkTool;
    mode: DockAnnotationSession['mode'];
    still?: { imageId: string; pixels: DockCapturedPixels };
  }): Promise<DockNativeResult<void>>;
  setAnnotationTool(sessionId: string, tool: DockMarkTool): Promise<void>;
  /** Mouse mode: the screen is used normally until a tool is chosen again. */
  setAnnotationMouse?(sessionId: string): Promise<void>;
  /** The composer's Screenshot/Record state, mirrored on the annotate tool bar. */
  setAnnotationMedia?(media: DockAnnotationMediaState): Promise<void>;
  /** Renderer is authoritative: redraw the session image's outlines and badges (undo, renumber, removal). */
  syncMarks(
    sessionId: string,
    marks: { n: number; tool: DockMarkTool; geometry: DockMarkGeometry }[],
  ): Promise<void>;
  endAnnotation(sessionId: string): Promise<void>;
  startClip(
    clipId: string,
    options: { includeMic: boolean; maxMs: number },
  ): Promise<DockNativeResult<void>>;
  stopClip(clipId: string): Promise<DockNativeResult<DockClipFile>>;
  /** Best-effort: delete native's finished source file once the daemon holds the attachment. */
  releaseClip?(clipId: string): Promise<DockNativeResult<void>>;
  /**
   * The renderer's answer for one native-minted gesture id: native holds that
   * mark's speech reference and words until it is answered (false drops only it).
   * Qualified by the original annotation id, so it may arrive after the session ended.
   */
  reportMarkAcceptance?(
    annotationId: string,
    markId: string,
    accepted: boolean,
  ): Promise<DockNativeResult<void>>;
  subscribe(listener: (event: DockEvidenceNativeEvent) => void): () => void;
}

/** Narrow a native annotate issue; anything outside the main-process schema is dropped. */
export function sanitizeDockAnnotationIssue(value: unknown): DockAnnotationIssue | null {
  const row = value as Partial<DockAnnotationIssue> | null;
  return row &&
    typeof row.sessionId === 'string' &&
    row.sessionId.length > 0 &&
    row.sessionId.length <= 128 &&
    (row.kind === 'pick' || row.kind === 'target' || row.kind === 'capture') &&
    (row.error === 'permission' || row.error === 'unavailable')
    ? { sessionId: row.sessionId, kind: row.kind, error: row.error }
    : null;
}
