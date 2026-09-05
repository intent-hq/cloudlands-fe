import type { ContextItem } from '$lib/components/chat/input/context-api';
import {
  formatFileSize,
  imageFilesToContextItems,
  REFERENCE_IMAGE_MAX_BYTES,
} from '$lib/components/chat/input/image-context-items';

interface StageFilesOptions {
  getPathForFile?: (file: File) => string;
  convertImages?: typeof imageFilesToContextItems;
  now?: () => number;
}

export async function stageNewWorkspaceFiles(
  files: File[],
  options: StageFilesOptions = {},
): Promise<ContextItem[]> {
  const images: File[] = [];
  const staged: ContextItem[] = [];
  const now = options.now ?? Date.now;
  const getPathForFile =
    options.getPathForFile ??
    ((file: File): string =>
      (
        window as unknown as { electronAPI?: { getPathForFile?: (value: File) => string } }
      ).electronAPI?.getPathForFile?.(file) ?? '');

  for (const [index, file] of files.entries()) {
    if (file.type.startsWith('image/')) {
      images.push(file);
      continue;
    }
    const sourcePath = getPathForFile(file);
    staged.push({
      id: `staged-file-${now()}-${index}`,
      type: 'file',
      label: file.name,
      description: `${file.type || 'file'} • ${formatFileSize(file.size)}`,
      path: file.name,
      attachmentMimeType: file.type || undefined,
      attachmentSize: file.size,
      sourcePath,
      placementStatus: sourcePath ? undefined : 'failed',
    });
  }

  const convertedImages = await (options.convertImages ?? imageFilesToContextItems)(images, {
    maxBytes: REFERENCE_IMAGE_MAX_BYTES,
  });
  return [...staged, ...convertedImages];
}
