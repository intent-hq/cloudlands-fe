import { backendRequest } from '$lib/client/live/backend-transport';
import { isSupportedImageMimeType } from '$lib/components/chat/input/image-attachment-format';
import { workspaceAssetImageSource } from '$lib/utils/workspace-file-image';

export interface DiscussionImage {
  name: string;
  url: string;
}

const IMAGE_LINE = /^!\[([^\]\n]*)\]\((workspace-asset:\/\/[^\s()]+)\)$/;
const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/**
 * Attached images are trailing Markdown image lines of the plain-text body, so
 * drafts, retries, history and agent delivery carry them without a new contract.
 * Only same-workspace image assets count; anything else stays message text.
 */
export function splitDiscussionBody(
  body: string,
  workspaceId: string | undefined,
): { text: string; images: DiscussionImage[] } {
  const lines = body.split('\n');
  const images: DiscussionImage[] = [];
  let index = lines.length;
  while (index > 0) {
    const match = IMAGE_LINE.exec(lines[index - 1]);
    if (!match || !workspaceAssetImageSource(match[2], workspaceId)) break;
    images.unshift({ name: match[1], url: match[2] });
    index--;
  }
  if (!images.length) return { text: body, images };
  const text = lines.slice(0, index).join('\n');
  return { text: text.endsWith('\n') ? text.slice(0, -1) : text, images };
}

export function joinDiscussionBody(text: string, images: readonly DiscussionImage[]): string {
  if (!images.length) return text;
  const lines = images.map(
    ({ name, url }) => `![${name.replace(/[[\]()\\\n\r]/g, '').trim() || 'image'}](${url})`,
  );
  return text ? `${text}\n\n${lines.join('\n')}` : lines.join('\n');
}

export function discussionImageMimeType(url: string): string {
  return MIME_BY_EXTENSION[url.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? ''] ?? '';
}

export function isDiscussionImageFile(file: File): boolean {
  return isSupportedImageMimeType(file.type);
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}

export async function uploadDiscussionImage(
  workspaceId: string,
  file: File,
): Promise<DiscussionImage> {
  const result = await backendRequest<{ url?: unknown }>('note.saveAsset', {
    workspaceId,
    data: await readDataUrl(file),
    mimeType: file.type,
    originalName: file.name,
  });
  const url = typeof result?.url === 'string' ? result.url : '';
  if (!workspaceAssetImageSource(url, workspaceId)) throw new Error('Invalid image upload');
  return { name: file.name, url };
}
