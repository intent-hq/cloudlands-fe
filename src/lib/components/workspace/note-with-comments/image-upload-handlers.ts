import type { Editor } from '@tiptap/core';
import { toast } from 'svelte-sonner';
import { backendRequest } from '$lib/client/live/backend-transport';
import { m } from '$shared/paraglide/messages.js';
import type { LoggerLike } from './logger.types';

/** PROTOCOL §5.2 `note.saveAsset` result — `url` round-trips through `note.readAsset`. */
type SaveAssetResult = {
  assetId: string;
  path: string;
  url: string;
};

async function fileToDataUrl(file: File): Promise<string> {
  const reader = new FileReader();

  const base64Promise = new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });

  reader.readAsDataURL(file);
  return await base64Promise;
}

export async function uploadImageAndInsert(params: {
  file: File;
  editor: Editor | null | undefined;
  workspaceId: string | null | undefined;
  logger: LoggerLike;
}): Promise<void> {
  const { file, editor, workspaceId, logger } = params;
  if (!editor || !workspaceId) return;

  try {
    const dataUrl = await fileToDataUrl(file);

    const result = await backendRequest<SaveAssetResult>('note.saveAsset', {
      workspaceId,
      data: dataUrl,
      mimeType: file.type,
      originalName: file.name,
    });

    editor.chain().focus().setImage({ src: result.url }).run();
    logger.info('Image inserted into note', { assetId: result.assetId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to upload image', { error: message }); // i18n-ignore (log line)
    toast.error(m.workspace_noteWithComments_imageUploadFailed_error(), { description: message });
  }
}

export function createImagePasteHandler(params: {
  getEditor: () => Editor | null | undefined;
  getWorkspaceId: () => string | null | undefined;
  logger: LoggerLike;
}): (event: ClipboardEvent) => void {
  const { getEditor, getWorkspaceId, logger } = params;

  return (event: ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const file = item.getAsFile();
        if (file) {
          void uploadImageAndInsert({
            file,
            editor: getEditor(),
            workspaceId: getWorkspaceId(),
            logger,
          });
        }
        return;
      }
    }
  };
}

export function createImageDropHandler(params: {
  getEditor: () => Editor | null | undefined;
  getWorkspaceId: () => string | null | undefined;
  logger: LoggerLike;
}): (event: DragEvent) => void {
  const { getEditor, getWorkspaceId, logger } = params;

  return (event: DragEvent) => {
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;

    for (const file of files) {
      if (file.type.startsWith('image/')) {
        event.preventDefault();
        void uploadImageAndInsert({
          file,
          editor: getEditor(),
          workspaceId: getWorkspaceId(),
          logger,
        });
        return;
      }
    }
  };
}
