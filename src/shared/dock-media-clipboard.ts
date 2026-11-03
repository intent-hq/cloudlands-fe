/**
 * Copy, cut and paste of dock composer media (screenshots and finished recordings).
 *
 * Other apps get the real file: a PNG (image data and a file reference) or the
 * video file. Intent keeps its own metadata beside that file, in a folder main
 * owns (not the draft), so a paste in any workspace's dock draft restores an
 * editable screenshot (raw pixels plus its marks) or a recording with its duration,
 * under fresh ids, even after the source draft is gone.
 */
import type { DockCapturedPixels, DockMark } from './dock-evidence';

/** Mirrored into the central registry (`DOCK_MEDIA` group). */
export const DOCK_MEDIA_CHANNELS = {
  /** dock → main invoke: `DockMediaClipboardWrite` → `DockMediaClipboardResult`. */
  CLIPBOARD_WRITE: 'dock-media:clipboard-write',
  /** dock → main invoke: `{}` → `DockMediaClipboardContent | null` (Intent media only). */
  CLIPBOARD_READ: 'dock-media:clipboard-read',
  /** dock → main invoke: `{ canCut }` → `{ action: 'copy' | 'cut' | null }`. */
  MENU: 'dock-media:menu',
} as const;

/** One editable mark, without its identity (a paste mints new ones). */
export type DockMediaClipboardMark = Pick<DockMark, 'tool' | 'geometry' | 'bounds' | 'element'>;

export type DockMediaClipboardWrite =
  | {
      kind: 'image';
      name: string;
      mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
      /** What other apps get: the image as shown (a screenshot with its marks drawn in). */
      bytes: Uint8Array;
      /** Screenshots only: the raw capture and its marks, for an editable paste. */
      intent?: {
        pixels: Omit<DockCapturedPixels, 'base64' | 'image'>;
        raw: Uint8Array;
        marks: DockMediaClipboardMark[];
      };
    }
  | {
      kind: 'clip';
      name: string;
      mimeType: string;
      bytes: Uint8Array;
      durationMs: number;
      hasMicAudio: boolean;
    };

export type DockMediaClipboardResult =
  { ok: true } | { ok: false; error: 'unsupported' | 'invalid' | 'failed' };

/** Intent media found on the clipboard (never anything another app wrote). */
export type DockMediaClipboardContent =
  | {
      kind: 'image';
      /** The file other apps were given; `size` lets a paste match it to its event. */
      name: string;
      size: number;
      pixels: DockCapturedPixels;
      marks: DockMediaClipboardMark[];
    }
  | {
      kind: 'clip';
      name: string;
      mimeType: string;
      /** Main-readable file the destination draft places from. */
      sourcePath: string;
      /** Its byte size; a paste also uses it to match the entry to its event. */
      size: number;
      durationMs: number;
      hasMicAudio: boolean;
    };

/**
 * Where a paste gesture happened: the open conversation (its generation and
 * authority; reopening or switching agents moves the generation), the draft's
 * lifecycle (its clear counter moves on every admitted send) and the backend (window backend, connection generation,
 * transport). A paste completing later lands only if all still hold, so it never
 * reaches a reopened, sent or other-machine draft.
 */
export interface DockPasteOrigin {
  generation: number;
  authority: unknown;
  clearRevision: number;
  binding: { backendId: string | null; generation: number; transport: unknown };
}
