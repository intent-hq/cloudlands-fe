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
import { IPC_CHANNELS } from './ipc-registry';
import { DOCK_MARK_TOOLS, type DockMarkTool } from './dock-evidence';
import {
  DockMediaSaveRequestSchema,
  DockMediaEditSchema,
  DockMediaSourceSchema,
  DockMediaTranscriptSchema,
  type DockMediaEdit,
  type DockMediaOutputError,
  type DockMediaSaveRequest,
  type DockMediaSource,
  type DockMediaTranscript,
} from './dock-media-edit';

export const DOCK_CAPTURE_EDITOR_CHANNELS = IPC_CHANNELS.DOCK_CAPTURE_EDITOR;
export const DOCK_CAPTURE_EDITOR_ROUTE = '/dock-capture-editor';

export type DockCaptureEditorKind = 'recording' | 'screenshot';

/** How the source was captured, so the editor never claims more than it has. */
export interface DockCaptureEditorProvenance {
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
  /** The saved edit of this source, if any. */
  saved?: DockMediaEdit | null;
  transcript?: DockMediaTranscript | null;
  /**
   * Whether sending honors a saved edit of this source. Save is offered only when
   * it does; until then edits are a preview and are never stored.
   */
  output?: { ready: boolean; reason?: DockMediaOutputError };
}

/** What the editor window receives: the request, with main's own media URL. */
export interface DockCaptureEditorSnapshot extends Omit<
  DockCaptureEditorOpenRequest,
  'attachmentPath'
> {
  openId: string;
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
    saved: DockMediaEditSchema.nullable().optional(),
    transcript: DockMediaTranscriptSchema.nullable().optional(),
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
  );

/** Close (and Discard, Keep editing) name the session they mean; others are untouched. */
export const DockCaptureEditorCloseSchema = z.object({ openId: z.string().uuid() }).strict();
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

/** main → the opening dock: one save to persist, correlated by `requestId`. */
export interface DockCaptureEditorSaveRequested {
  requestId: string;
  request: DockMediaSaveRequest;
}

export type DockCaptureEditorSaveOutcome =
  'saved' | 'stale-source' | 'revision-conflict' | 'failed';

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

export const DockCaptureEditorSaveSchema = DockMediaSaveRequestSchema;

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
export type DockCaptureEditorTranscriptUpdate = z.infer<
  typeof DockCaptureEditorTranscriptUpdateSchema
>;

/**
 * main → the opening dock: capture the screenshot again in the same mode and place
 * it as a new file, without changing the attachment (Save swaps it in, atomically).
 */
export interface DockCaptureEditorRetakeRequested {
  requestId: string;
  pair: { workspaceId: string; agentId: string };
  /** The source being replaced, as the session knows it. */
  expected: { sourceId: string; sourceRevision: number };
}

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
