/**
 * Capture editor (Capture and recording editor spec, Nov 3 2026): one editor window
 * for anything attached from the screen, recordings and screenshots, opened from
 * the attachment's pill in the dock's prompt box. The kind decides which view the
 * shared shell shows; this contract is the same for both.
 *
 * The dock asks main to open it for one attachment of one pair. Main never takes a
 * renderer URL: it resolves the media from the attachment's canonical
 * workspace-relative path, and only the dock window that opened it (same document,
 * same backend binding) owns the session.
 */
import { z } from 'zod';
import { DockMediaWaveformSchema, type DockMediaWaveform } from './dock-media-output';
import { IPC_CHANNELS } from './ipc-registry';
import { DOCK_MARK_TOOLS, type DockMarkTool } from './dock-evidence';
import {
  DockMediaEditSchema,
  DockMediaSourceSchema,
  DockMediaTranscriptSchema,
  type DockMediaEdit,
  type DockMediaChoice,
  type DockMediaOutputError,
  type DockMediaSource,
  type DockMediaTranscript,
} from './dock-media-edit';

export const DOCK_CAPTURE_EDITOR_CHANNELS = IPC_CHANNELS.DOCK_CAPTURE_EDITOR;
export const DOCK_CAPTURE_EDITOR_ROUTE = '/dock-capture-editor';

type DockCaptureEditorKind = 'recording' | 'screenshot';

/** How the source was captured, so the editor never claims more than it has. */
interface DockCaptureEditorProvenance {
  /** Native capture API, when recorded. */
  captureApi?: string;
  /** The recording carries microphone audio. */
  hasMicAudio?: boolean;
  /**
   * `baked-marks`: marks drawn while recording are part of the video frames, so a
   * mark cannot be removed from it. `clean`: no marks were drawn into it.
   */
  visuals: 'clean' | 'baked-marks';
}

/** A mark as the editor shows it: where it is in the recording, and what kind. */
export interface DockCaptureEditorMark {
  id: string;
  tool: DockMarkTool;
  /** Recording time of the mark; null for a screenshot mark. */
  atMs: number | null;
  /** Short label: the clicked element's text, when there is one. */
  label?: string;
}

export interface DockCaptureEditorOpenRequest {
  /** The capture's dock hold (HOLD_BEGIN) this editor adopts while it is open. */
  holdToken?: string;
  kind: DockCaptureEditorKind;
  workspaceId: string;
  agentId: string;
  attachmentId: string;
  /** Changes whenever the attachment's source changes (it is replaced, not edited). */
  sourceRevision: string;
  /** Canonical workspace-relative path of the daemon-managed attachment. */
  attachmentPath: string;
  title: string;
  durationMs?: number;
  width?: number;
  height?: number;
  marks: DockCaptureEditorMark[];
  provenance: DockCaptureEditorProvenance;
  /**
   * The canonical source (shared/dock-media-edit) when it is known. Without it the
   * attachment opens read-only: it plays, but nothing can be edited or saved.
   */
  source?: DockMediaSource;
  /**
   * After a saved retake, the first capture: its captured marks are the Reset
   * baseline, carried onto the current pixels by their frames.
   */
  originalSource?: DockMediaSource;
  /** The saved edit of this source, if any. */
  saved?: DockMediaEdit | null;
  transcript?: DockMediaTranscript | null;
  /**
   * Whether sending honors a saved edit of this source. Save is offered only when
   * it does; until then edits are a preview and are never stored.
   */
  output?: {
    ready: boolean;
    reason?: DockMediaOutputError;
    /**
     * The output pipeline's version (main-set from the output owner): 2 honors blur
     * strokes and sticky notes. Missing means 1, which must not save edits using them.
     */
    version?: number;
  };
  /** Real decoded audio peaks of the source, when the dock has analyzed it (main-set). */
  waveform?: DockMediaWaveform;
  /** The person's last saved Video/Voice choice: the default for a new edit (main-set). */
  rememberedChoice?: DockMediaChoice;
}

/** What the editor window receives: the request, with main's own media URL. */
export interface DockCaptureEditorSnapshot extends Omit<
  DockCaptureEditorOpenRequest,
  'attachmentPath'
> {
  openId: string;
  /** Main supports identity-bound removal from the owning draft. */
  deleteReady?: boolean;
  /** `workspace-file://` URL main resolved from the attachment path. */
  mediaUrl: string;
}

export type DockCaptureEditorOpenResult =
  { ok: true; openId: string } | { ok: false; error: string };

const id = z.string().min(1).max(200);
const mark = z
  .object({
    id,
    tool: z.enum(DOCK_MARK_TOOLS),
    atMs: z
      .number()
      .finite()
      .min(0)
      .max(24 * 60 * 60 * 1000)
      .nullable(),
    label: z.string().max(200).optional(),
  })
  .strict();

export const DockCaptureEditorOpenSchema = z
  .object({
    kind: z.enum(['recording', 'screenshot']),
    workspaceId: id,
    agentId: id,
    attachmentId: id,
    sourceRevision: z.string().min(1).max(512),
    attachmentPath: z.string().min(1).max(1024),
    title: z.string().max(200),
    durationMs: z
      .number()
      .finite()
      .min(0)
      .max(24 * 60 * 60 * 1000)
      .optional(),
    width: z.number().int().positive().max(32_768).optional(),
    height: z.number().int().positive().max(32_768).optional(),
    marks: z.array(mark).max(500),
    provenance: z
      .object({
        captureApi: z.string().max(100).optional(),
        hasMicAudio: z.boolean().optional(),
        visuals: z.enum(['clean', 'baked-marks']),
      })
      .strict(),
    source: DockMediaSourceSchema.optional(),
    originalSource: DockMediaSourceSchema.optional(),
    saved: DockMediaEditSchema.nullable().optional(),
    transcript: DockMediaTranscriptSchema.nullable().optional(),
    /** The capture's dock hold (HOLD_BEGIN) this editor adopts while it is open. */
    holdToken: z.string().uuid().optional(),
  })
  .strict()
  // The canonical source must describe this very attachment, and an edit this source.
  .refine(
    (request) =>
      !request.source ||
      (request.source.path === request.attachmentPath &&
        request.source.attachmentId === request.attachmentId &&
        request.source.kind === request.kind),
    'Source does not match the attachment',
  )
  .refine(
    (request) =>
      !request.saved ||
      (!!request.source &&
        request.saved.sourceId === request.source.id &&
        request.saved.sourceRevision === request.source.revision),
    'Edit does not match the source',
  )
  .refine(
    (request) =>
      !request.originalSource ||
      (request.source?.kind === 'screenshot' &&
        request.originalSource.kind === 'screenshot' &&
        request.originalSource.id !== request.source.id),
    'Original source does not precede this source',
  );

/** Close (and Discard, Keep editing) name the session they mean; others are untouched. */
export const DockCaptureEditorCloseSchema = z
  .object({
    openId: z.string().uuid(),
    /** The editor's Attach (after any save it needed succeeded), not Close or Cancel. */
    intent: z.literal('attach').optional(),
  })
  .strict();
/** The owner's answer to ATTACHED: return to that conversation (accept) or not. */
export const DockCaptureEditorAttachReturnSchema = z
  .object({ openId: z.string().uuid(), accept: z.boolean() })
  .strict();
/**
 * A dock hold around a capture that may open the editor (HOLD_BEGIN / HOLD_END). `hide`
 * (a screenshot) takes the dock out of sight at once and loads the editor window, hidden.
 */
export const DockCaptureEditorHoldSchema = z
  .object({ token: z.string().uuid(), hide: z.literal(true).optional() })
  .strict();
/**
 * main → the opening dock: its editor attached. The dock returns to exactly this
 * conversation only while this attachment's source is still the one the editor had.
 */
export interface DockCaptureEditorAttached {
  openId: string;
  workspaceId: string;
  agentId: string;
  attachmentId: string;
  sourceId: string | null;
  sourceRevision: number | null;
}
/**
 * The answer to one of main's "edits would be lost" requests: Discard does what was
 * waiting, Keep editing drops it. An answer to an older request does nothing.
 */
export const DockCaptureEditorAnswerSchema = z
  .object({ openId: z.string().uuid(), requestId: z.string().uuid() })
  .strict();

const ATTACHMENT_ROOT = ['.intent', 'attachments'] as const;
const SAFE_SEGMENT = /^[^\u0000-\u001f\u007f/\\:*?"<>|]+$/;

/**
 * The attachment's path if it is a canonical workspace-relative path inside the
 * daemon's attachment folder: no absolute or drive paths, no backslashes, no empty,
 * `.` or `..` segments, no control or reserved characters. A matching prefix alone
 * is not enough; anything else is null.
 */
export function canonicalDockAttachmentPath(value: string): string | null {
  if (!value || value.length > 1024 || value.startsWith('/') || value.includes('\\')) return null;
  if (/^[A-Za-z]:/.test(value)) return null;
  const segments = value.split('/');
  if (segments.length <= ATTACHMENT_ROOT.length) return null;
  if (ATTACHMENT_ROOT.some((part, index) => segments[index] !== part)) return null;
  for (const segment of segments.slice(ATTACHMENT_ROOT.length))
    if (!segment || segment === '.' || segment === '..' || !SAFE_SEGMENT.test(segment)) return null;
  return segments.join('/');
}

type DockCaptureEditorSaveOutcome = 'saved' | 'stale-source' | 'revision-conflict' | 'failed';

/** dock → main (and main → editor): how that save ended; `saved` is the stored edit. */
export interface DockCaptureEditorSaveResult {
  requestId: string;
  result: DockCaptureEditorSaveOutcome;
  saved?: DockMediaEdit;
}

export const DockCaptureEditorSaveResultSchema = z
  .object({
    requestId: z.string().uuid(),
    result: z.enum(['saved', 'stale-source', 'revision-conflict', 'failed']),
    saved: DockMediaEditSchema.optional(),
  })
  .strict()
  .refine((value) => (value.result === 'saved') === !!value.saved, 'Saved edit missing');

/**
 * dock → main: a newer transcript for the open session's source (recognition finished
 * or progressed). Only the dock that opened the session, for its own pair and source,
 * and only a strictly newer revision.
 */
export const DockCaptureEditorTranscriptUpdateSchema = z
  .object({
    pair: z
      .object({ workspaceId: z.string().min(1).max(200), agentId: z.string().min(1).max(200) })
      .strict(),
    sourceId: z.string().min(1).max(512),
    sourceRevision: z.number().int().nonnegative(),
    transcript: DockMediaTranscriptSchema,
  })
  .strict();

/** dock → main: the placed candidate's canonical source, or why there is none. */
export const DockCaptureEditorRetakeResultSchema = z.union([
  z
    .object({ requestId: z.string().uuid(), ok: z.literal(true), source: DockMediaSourceSchema })
    .strict(),
  z
    .object({
      requestId: z.string().uuid(),
      ok: z.literal(false),
      error: z.enum(['cancelled', 'permission', 'failed']),
    })
    .strict(),
]);
export type DockCaptureEditorRetakeResult = z.infer<typeof DockCaptureEditorRetakeResultSchema>;

/** main → editor: the candidate to show, by main's token; Save names only the token. */
export type DockCaptureEditorRetakeOutcome =
  | { ok: true; candidateToken: string; source: DockMediaSource; mediaUrl: string }
  | { ok: false; error: 'cancelled' | 'permission' | 'failed' };

// ---------------------------------------------------------------------------
// Note dictation (screenshot marks): hold the mic in a mark's note field to dictate.
// The adapter mints a monotonic generation per dictation; every accepted start ends
// with exactly one final update for that generation (stop, natural end or error).
// ---------------------------------------------------------------------------

export const DOCK_NOTE_MAX = 20_000;
type DockCaptureEditorNotePhase = 'start' | 'stop';
type DockCaptureEditorNoteError = 'busy' | 'unavailable' | 'failed' | 'permission';

export interface DockCaptureEditorNoteDictationRequest {
  openId: string;
  markId: string;
  /** Integer ≥ 0, minted by the editor, monotonic per editor. */
  generation: number;
  phase: DockCaptureEditorNotePhase;
}
export const DockCaptureEditorNoteDictationSchema = z
  .object({
    openId: z.string().uuid(),
    markId: z.string().min(1).max(512),
    generation: z.number().int().nonnegative(),
    phase: z.enum(['start', 'stop']),
  })
  .strict();

/** Start ok: listening started (an update follows); stop ok: a stop was sent for it. */
export interface DockCaptureEditorNoteDictationAck {
  ok: boolean;
  error?: 'busy' | 'unavailable' | 'failed';
}

/** main → the opening dock. */
export interface DockCaptureEditorNoteDictationRequested {
  requestId: string;
  pair: { workspaceId: string; agentId: string };
  markId: string;
  generation: number;
  phase: DockCaptureEditorNotePhase;
}

/** dock → main: the dictation's cumulative text, or its end (final, with error if any). */
export const DockCaptureEditorNoteDictationTextSchema = z
  .object({
    requestId: z.string().uuid(),
    generation: z.number().int().nonnegative(),
    text: z.string().max(DOCK_NOTE_MAX),
    final: z.boolean(),
    error: z.enum(['busy', 'unavailable', 'failed', 'permission']).optional(),
  })
  .strict()
  .refine((value) => !value.error || value.final, 'An error is final');
export type DockCaptureEditorNoteDictationText = z.infer<
  typeof DockCaptureEditorNoteDictationTextSchema
>;

/** main → editor. */
export interface DockCaptureEditorNoteDictationUpdate {
  openId: string;
  markId: string;
  generation: number;
  /** The whole text of this dictation so far (≤ 20000). */
  text: string;
  /** True exactly once, last: on stop, natural end or error. */
  final: boolean;
  error?: DockCaptureEditorNoteError;
}

/** dock → main: the open source's waveform (decoded peaks on the source clock). */
export const DockCaptureEditorWaveformUpdateSchema = z
  .object({
    pair: z
      .object({ workspaceId: z.string().min(1).max(200), agentId: z.string().min(1).max(200) })
      .strict(),
    sourceId: z.string().min(1).max(512),
    sourceRevision: z.number().int().nonnegative(),
    waveform: DockMediaWaveformSchema,
  })
  .strict();

/** Main fills this from the bound session; renderer never chooses a deletion target. */
export const DockCaptureEditorDeleteRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    openId: id,
    pair: z.object({ workspaceId: id, agentId: id }).strict(),
    kind: z.enum(['screenshot', 'recording']),
    attachmentId: id,
    sourceId: id.optional(),
    sourceRevision: z.number().int().nonnegative().optional(),
    expectedEditRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export type DockCaptureEditorDeleteRequest = z.infer<typeof DockCaptureEditorDeleteRequestSchema>;
export const DockCaptureEditorDeleteResultSchema = z
  .object({
    requestId: z.string().uuid(),
    result: z.enum(['deleted', 'stale-source', 'failed']),
  })
  .strict();
export type DockCaptureEditorDeleteResult = z.infer<typeof DockCaptureEditorDeleteResultSchema>;

/** Owner-only CHANGED payload: retire a pending compact handoff for this editor. */
export const DockCaptureEditorEndedSchema = z.object({ endedOpenId: z.string().uuid() }).strict();
