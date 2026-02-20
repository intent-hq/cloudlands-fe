import type { Editor } from '@tiptap/core';
import type { LoggerLike } from './logger.types';

export type InvokeLike = (channel: string, payload: unknown) => Promise<unknown>;

type AssetsSaveResult = {
  success: boolean;
  data?: { assetId: string; url: string };
  error?: string;
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
  invoke: InvokeLike;
  logger: LoggerLike;
}): Promise<void> {
  const { file, editor, workspaceId, invoke, logger } = params;
  if (!editor || !workspaceId) return;

  try {
    const dataUrl = await fileToDataUrl(file);

    const result = (await invoke('assets:save', {
      workspaceId,
      data: dataUrl,
      mimeType: file.type,
      originalName: file.name,
    })) as AssetsSaveResult;

    if (result.success && result.data) {
      editor.chain().focus().setImage({ src: result.data.url }).run();
      logger.info('Image inserted into note', { assetId: result.data.assetId });
    } else {
      logger.error('Failed to upload image', { error: result.error });
    }
  } catch (error) {
    logger.error('Error uploading image', error);
  }
}

export function createImagePasteHandler(params: {
  getEditor: () => Editor | null | undefined;
  getWorkspaceId: () => string | null | undefined;
  invoke: InvokeLike;
  logger: LoggerLike;
}): (event: ClipboardEvent) => void {
  const { getEditor, getWorkspaceId, invoke, logger } = params;

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
            invoke,
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
  invoke: InvokeLike;
  logger: LoggerLike;
}): (event: DragEvent) => void {
  const { getEditor, getWorkspaceId, invoke, logger } = params;

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
          invoke,
          logger,
        });
        return;
      }
    }
  };
}
