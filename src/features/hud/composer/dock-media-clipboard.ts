/**
 * Dock composer side of media copy/cut/paste (see `$shared/dock-media-clipboard`).
 *
 * Copy gathers what other apps need (the screenshot as shown, or the recording's
 * file). Unsaved captures retain raw pixels and editable marks; saved screenshots
 * are flattened through the canonical exporter so internal paste cannot restore
 * cropped or blurred pixels. Main puts the result on the system clipboard. Paste lets text
 * through untouched; when files are pasted it asks main whether they are Intent
 * media, and otherwise hands the very same clipboard to the editor's own paste.
 */
import type { createDockSavedPreviewUrl } from './dock-saved-preview';
import { DOCK_MEDIA_CHANNELS } from '$shared/dock-media-clipboard';
import type {
  DockMediaClipboardContent,
  DockMediaClipboardResult,
  DockMediaClipboardWrite,
} from '$shared/dock-media-clipboard';
import type { ContextItem } from '$lib/components/chat/input/context-api';
import type { selectDockComposerEvidence } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
import { dockClipPlaybackUrl } from './dock-composer-presentation';

type EvidenceView = ReturnType<typeof selectDockComposerEvidence.select>;
type Bridge = { invoke: (channel: string, payload?: unknown) => Promise<unknown> };
const bridge = (): Bridge | undefined => (globalThis as { electronAPI?: Bridge }).electronAPI;

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
const imageType = (value: string | undefined): ImageType | null =>
  (IMAGE_TYPES as readonly string[]).includes(value ?? '') ? (value as ImageType) : null;

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

export interface DockMediaCopySource {
  workspaceId: string;
  view: EvidenceView;
  items: readonly ContextItem[];
  /** Composited preview (marks drawn in) per screenshot id. */
  previews: Readonly<Record<string, string>>;
  fetchBytes: (url: string) => Promise<Uint8Array>;
  /** Fresh canonical export; displayed previews may still belong to an older edit. */
  createSavedPreviewUrl?: typeof createDockSavedPreviewUrl;
  revokeUrl?: (url: string) => void;
}

/** What to put on the clipboard for one composer tile, or null when it cannot be copied. */
export async function dockMediaCopyRequest(
  id: string,
  source: DockMediaCopySource,
): Promise<DockMediaClipboardWrite | null> {
  const { view, items, previews } = source;
  const tile = view.tiles.find(({ image }) => image.id === id || image.contextItemId === id);
  if (tile) {
    const raw = items.find((row) => row.id === tile.image.contextItemId);
    const media = tile.image.media;
    if (tile.image.mediaError) return null;
    if (media?.saved) {
      if (!source.createSavedPreviewUrl || !source.revokeUrl) return null;
      // Internal paste must never resurrect pixels hidden by saved crop/blur.
      // Bake all edits once and start the pasted capture with no legacy marks.
      const saved = { ...media, saved: media.saved };
      const url = await source.createSavedPreviewUrl(source.workspaceId, saved);
      try {
        const bytes = await source.fetchBytes(url);
        const crop = saved.saved.crop;
        return {
          kind: 'image',
          name: raw?.label || 'screenshot.png',
          mimeType: 'image/png',
          bytes,
          intent: {
            pixels: {
              mimeType: 'image/png',
              width: Math.max(1, Math.round(crop?.w ?? saved.source.width)),
              height: Math.max(1, Math.round(crop?.h ?? saved.source.height)),
              displayScale: tile.image.displayScale,
              capturedAt: tile.image.capturedAt,
            },
            raw: bytes,
            marks: [],
          },
        };
      } finally {
        source.revokeUrl(url);
      }
    }
    const rawType = imageType(raw?.imageMimeType);
    const preview = previews[tile.image.id];
    if (!raw?.imageData || !rawType || !preview) return null;
    return {
      kind: 'image',
      name: raw.label || 'screenshot.png',
      mimeType: 'image/png',
      bytes: await source.fetchBytes(preview),
      intent: {
        pixels: {
          mimeType: rawType,
          width: tile.image.width,
          height: tile.image.height,
          displayScale: tile.image.displayScale,
          capturedAt: tile.image.capturedAt,
          ...(tile.image.hash ? { hash: tile.image.hash } : {}),
        },
        raw: decodeBase64(raw.imageData),
        marks: tile.marks.map(({ mark }) => ({
          tool: mark.tool,
          geometry: mark.geometry,
          bounds: mark.bounds,
          element: mark.element,
        })),
      },
    };
  }
  const clip = view.clips.find((row) => row.id === id || row.contextItemId === id);
  if (clip) {
    const url = clip.status === 'ready' ? dockClipPlaybackUrl(source.workspaceId, clip.path) : null;
    if (!url) return null;
    const item = items.find((row) => row.id === clip.contextItemId);
    const bytes = await source.fetchBytes(url);
    if (!isMovieFile(bytes)) throw new Error('Not a recording file');
    return {
      kind: 'clip',
      name: item?.label || `recording-${clip.id.slice(0, 8)}.mp4`,
      mimeType: item?.attachmentMimeType || 'video/mp4',
      bytes,
      durationMs: clip.durationMs,
      hasMicAudio: clip.hasMicAudio,
    };
  }
  // An ordinary pasted or dropped image: the image itself, nothing Intent-specific.
  const item = items.find((row) => row.id === id);
  const type = imageType(item?.imageMimeType);
  if (item?.imageData && type)
    return {
      kind: 'image',
      name: item.label || 'image',
      mimeType: type,
      bytes: decodeBase64(item.imageData),
    };
  return null;
}

/**
 * The complete bytes behind a media URL, or a rejection: a failed response (a
 * missing file answers 404 with a body), an empty body, or fewer bytes than the
 * response declared never become something a copy, or a cut, reports as done.
 */
export async function fetchDockMediaBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Media request failed (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (bytes.byteLength === 0 || (Number.isFinite(declared) && declared !== bytes.byteLength))
    throw new Error('Media response was incomplete');
  return bytes;
}

/** An MP4/QuickTime file starts with its `ftyp` box; anything else is not the recording. */
function isMovieFile(bytes: Uint8Array): boolean {
  return bytes.byteLength > 8 && String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp';
}

export async function writeDockMediaClipboard(request: DockMediaClipboardWrite): Promise<boolean> {
  try {
    const result = (await bridge()?.invoke(DOCK_MEDIA_CHANNELS.CLIPBOARD_WRITE, request)) as
      DockMediaClipboardResult | undefined;
    return result?.ok === true;
  } catch {
    return false;
  }
}

async function readDockMediaClipboard(): Promise<DockMediaClipboardContent | null> {
  try {
    return ((await bridge()?.invoke(DOCK_MEDIA_CHANNELS.CLIPBOARD_READ, {})) ??
      null) as DockMediaClipboardContent | null;
  } catch {
    return null;
  }
}

export async function showDockMediaMenu(canCut: boolean): Promise<'copy' | 'cut' | null> {
  try {
    const result = (await bridge()?.invoke(DOCK_MEDIA_CHANNELS.MENU, { canCut })) as
      { action?: unknown } | undefined;
    return result?.action === 'copy' || result?.action === 'cut' ? result.action : null;
  } catch {
    return null;
  }
}

const replayed = new WeakSet<Event>();

/**
 * Whether this paste is exactly the clipboard entry main describes: a single file
 * (several files, or extra file items, are never one Intent copy) whose bytes have
 * the entry's size and SHA-256. Name and size alone are not identity.
 */
async function isSameFile(files: readonly File[], content: DockMediaClipboardContent) {
  const [file] = files;
  if (files.length !== 1 || !file || file.size !== content.size) return false;
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const hex = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    return hex === content.sha256;
  } catch {
    return false;
  }
}

export interface DockMediaPasteHandlers {
  /** Places Intent media in the draft the paste was made in. */
  onIntentMedia: (content: DockMediaClipboardContent) => void;
  /** Whether that draft (conversation, draft lifecycle, machine) is still the open one. */
  isCurrent: () => boolean;
  read?: () => Promise<DockMediaClipboardContent | null>;
}

/**
 * Capture-phase paste on the composer. Text-only pastes are never touched. With
 * files on the clipboard the event is held while main says whether they are Intent
 * media. The answer is used only if it is about this event's own, single file
 * (same SHA-256: the clipboard may have changed during the read) and the draft it
 * was pasted in is still the open one; otherwise this event's own files and text are
 * replayed to the original target for the editor's own paste path, provided that
 * target is still in the same, current draft. A stale paste does nothing.
 */
export function interceptDockMediaPaste(
  event: ClipboardEvent,
  { onIntentMedia, isCurrent, read = readDockMediaClipboard }: DockMediaPasteHandlers,
): boolean {
  const data = event.clipboardData;
  if (replayed.has(event) || !data || data.files.length === 0) return false;
  const target = event.target;
  const files = Array.from(data.files);
  const strings = data.types
    .filter((type) => type !== 'Files')
    .map((type) => [type, data.getData(type)] as const);
  event.preventDefault();
  event.stopImmediatePropagation();
  void read()
    .catch(() => null)
    .then(async (content) => {
      if (!isCurrent()) return;
      if (content && (await isSameFile(files, content))) {
        if (isCurrent()) onIntentMedia(content);
        return;
      }
      if (!isCurrent() || !(target instanceof Node) || !target.isConnected) return;
      const transfer = new DataTransfer();
      for (const file of files) transfer.items.add(file);
      for (const [type, value] of strings) transfer.setData(type, value);
      const replay = new ClipboardEvent('paste', {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      });
      replayed.add(replay);
      target.dispatchEvent(replay);
    });
  return true;
}
