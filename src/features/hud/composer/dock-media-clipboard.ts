/**
 * Dock composer side of media copy/cut/paste (see `$shared/dock-media-clipboard`).
 *
 * Copy gathers what other apps need (the screenshot as shown, or the recording's
 * file) and, for a screenshot, what Intent needs to keep it editable (raw pixels
 * and its marks), and asks main to put it on the system clipboard. Paste lets text
 * through untouched; when files are pasted it asks main whether they are Intent
 * media, and otherwise hands the very same clipboard to the editor's own paste.
 */
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
    return {
      kind: 'clip',
      name: item?.label || `recording-${clip.id.slice(0, 8)}.mp4`,
      mimeType: item?.attachmentMimeType || 'video/mp4',
      bytes: await source.fetchBytes(url),
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
 * Capture-phase paste on the composer. Text-only pastes are never touched. With
 * files on the clipboard the event is held while main says whether they are Intent
 * media: if so `onIntentMedia` places them; if not, the same clipboard (files and
 * any text) is replayed to the original target for the editor's own paste path.
 */
export function interceptDockMediaPaste(
  event: ClipboardEvent,
  onIntentMedia: (content: DockMediaClipboardContent) => void,
  read: () => Promise<DockMediaClipboardContent | null> = readDockMediaClipboard,
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
  void read().then((content) => {
    if (content) return onIntentMedia(content);
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    for (const [type, value] of strings) transfer.setData(type, value);
    const replay = new ClipboardEvent('paste', {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    });
    replayed.add(replay);
    target?.dispatchEvent(replay);
  });
  return true;
}
