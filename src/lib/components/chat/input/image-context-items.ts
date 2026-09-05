/**
 * Shared image `File` → `ContextItem` conversion for composer surfaces
 * (SimpleRichInput, workspace creation shell). Reads each image as a
 * base64 data URL, enforces the caller's size cap up front, and surfaces
 * the standard toasts (added / failed / too-large) from the chat message
 * set. Non-image files are the caller's responsibility — pass only
 * `image/*` files here.
 */
import { toast } from 'svelte-sonner';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';
import type { ContextItem } from './context-api';
import { parseImageDataUrl } from './image-data-url';

const logger = createLogger('image-context-items');

// Monotonic disambiguator: Date.now() alone collides when two same-named
// files finish reading in the same millisecond, and thumbnail rows key /
// remove by item id.
let uploadSequence = 0;

/**
 * Composer cap for images that travel as attachment-reference blocks
 * (monorepo#3338): the send path places the bytes via file.placeAttachment /
 * chunked upload (image-attachment-placement.ts), so the cap matches the
 * daemon's 30 MiB reference-image limit rather than the old inline-frame
 * budget.
 */
export const REFERENCE_IMAGE_MAX_BYTES = 30 * 1024 * 1024;

/**
 * Legacy 10 MB inline-frame budget — for surfaces whose images stay inline
 * on the wire (the chief virtual workspace has no attachment registry).
 */
export const INLINE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/** Convert a File to a base64 data URL. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export interface ImageContextItemsOptions {
  /** Per-file size cap in bytes; oversized files are rejected with a toast. */
  maxBytes: number;
  /** Test seam: file → data-URL reader (defaults to FileReader). */
  readFile?: (file: File) => Promise<string>;
}

/**
 * Convert image `File`s into `ContextItem`s carrying `imageData` /
 * `imageMimeType`. Files over `maxBytes` are skipped and reported in one
 * too-large toast; unreadable/invalid files get a per-file failure toast;
 * a success toast reports the added count. Returns the created items —
 * appending them to composer state stays with the caller.
 */
export async function imageFilesToContextItems(
  files: File[],
  options: ImageContextItemsOptions,
): Promise<ContextItem[]> {
  const { maxBytes, readFile = fileToDataUrl } = options;
  const items: ContextItem[] = [];
  const oversizedFiles: string[] = [];

  for (const file of files) {
    if (file.size > maxBytes) {
      // Over the cap — rejected up front instead of failing at send time.
      oversizedFiles.push(file.name);
      continue;
    }

    try {
      const dataUrl = await readFile(file);
      // Extract base64 data from data URL (remove "data:image/...;base64," prefix)
      const parsed = parseImageDataUrl(dataUrl);
      if (!parsed) {
        throw new Error('Invalid data URL format');
      }
      const { mimeType, data: base64Data } = parsed;

      const timestamp = Date.now();
      const fileName = file.name || `image-${timestamp}.${mimeType.split('/')[1] || 'png'}`;
      items.push({
        id: `file-upload-${timestamp}-${++uploadSequence}-${fileName}`,
        type: 'file',
        label: fileName,
        description: `${mimeType} • ${formatFileSize(file.size)}`,
        path: fileName,
        file,
        imageData: base64Data,
        imageMimeType: mimeType,
      });
    } catch (error) {
      logger.error('Failed to add image to context', { fileName: file.name, error });
      toast.error(m.chat_richInput_addImageFailed_error({ name: file.name }));
    }
  }

  if (items.length > 0) {
    logger.debug(`Added ${items.length} image(s) to context`);
    toast.success(
      items.length === 1
        ? m.chat_richInput_addedImages_toast_one()
        : m.chat_richInput_addedImages_toast_many({ count: formatInteger(items.length) }),
    );
  }

  if (oversizedFiles.length > 0) {
    toast.error(m.chat_richInput_filesTooLarge_error({ names: oversizedFiles.join(', ') }));
  }

  return items;
}
