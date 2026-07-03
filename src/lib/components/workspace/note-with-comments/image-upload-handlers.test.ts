import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';

// FAKE transport only: the backend bridge is mocked so no request ever reaches
// the user's real daemon. Tests assert the exact JSON-RPC method + params the
// upload seam emits (PROTOCOL.md §5.2 note.saveAsset) and how it handles the
// PROTOCOL-shaped result/error.
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));
vi.mock('svelte-sonner', () => ({
  toast: { error: vi.fn() },
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { toast } from 'svelte-sonner';
import {
  createImageDropHandler,
  createImagePasteHandler,
  uploadImageAndInsert,
} from './image-upload-handlers';

const mockedRequest = vi.mocked(backendRequest);

/** PROTOCOL §5.2 `note.saveAsset` result shape. */
const saveResult = {
  assetId: 'asset-1',
  path: '/daemon/assets/ws-1/asset-1.png',
  url: 'workspace-asset://ws-1/asset-1.png',
};

function makeEditor() {
  const run = vi.fn();
  const setImage = vi.fn(() => ({ run }));
  const focus = vi.fn(() => ({ setImage }));
  const chain = vi.fn(() => ({ focus }));
  return { editor: { chain } as unknown as Editor, setImage, run };
}

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const pngFile = () =>
  new File([new Uint8Array([137, 80, 78, 71])], 'pic.png', { type: 'image/png' });

describe('image upload seam (daemon note.saveAsset, fake transport)', () => {
  afterEach(() => vi.clearAllMocks());

  it('uploadImageAndInsert sends note.saveAsset with the PROTOCOL params and inserts the returned url', async () => {
    mockedRequest.mockResolvedValueOnce(saveResult);
    const { editor, setImage } = makeEditor();

    await uploadImageAndInsert({ file: pngFile(), editor, workspaceId: 'ws-1', logger });

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    const [method, params] = mockedRequest.mock.calls[0] as [string, Record<string, unknown>];
    expect(method).toBe('note.saveAsset');
    expect(params.workspaceId).toBe('ws-1');
    expect(params.mimeType).toBe('image/png');
    expect(params.originalName).toBe('pic.png');
    expect(params.data).toMatch(/^data:image\/png;base64,/);

    expect(setImage).toHaveBeenCalledWith({ src: saveResult.url });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('surfaces daemon failure via toast + logger and does not insert', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('NOT_FOUND: workspace not found'));
    const { editor, setImage } = makeEditor();

    await uploadImageAndInsert({ file: pngFile(), editor, workspaceId: 'ws-1', logger });

    expect(setImage).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('Failed to upload image', {
      error: 'NOT_FOUND: workspace not found',
    });
    expect(toast.error).toHaveBeenCalledWith('Failed to upload image', {
      description: 'NOT_FOUND: workspace not found',
    });
  });

  it('bails without a wire call when editor or workspaceId is missing', async () => {
    const { editor } = makeEditor();
    await uploadImageAndInsert({ file: pngFile(), editor: null, workspaceId: 'ws-1', logger });
    await uploadImageAndInsert({ file: pngFile(), editor, workspaceId: null, logger });
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('paste handler extracts the image file and uploads it via note.saveAsset', async () => {
    mockedRequest.mockResolvedValueOnce(saveResult);
    const { editor, setImage } = makeEditor();
    const handler = createImagePasteHandler({
      getEditor: () => editor,
      getWorkspaceId: () => 'ws-1',
      logger,
    });

    const file = pngFile();
    const preventDefault = vi.fn();
    handler({
      preventDefault,
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => file }] },
    } as unknown as ClipboardEvent);

    expect(preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(setImage).toHaveBeenCalledWith({ src: saveResult.url }));
    expect(mockedRequest).toHaveBeenCalledWith(
      'note.saveAsset',
      expect.objectContaining({ workspaceId: 'ws-1', mimeType: 'image/png' }),
    );
  });

  it('drop handler uploads the first image file via note.saveAsset', async () => {
    mockedRequest.mockResolvedValueOnce(saveResult);
    const { editor, setImage } = makeEditor();
    const handler = createImageDropHandler({
      getEditor: () => editor,
      getWorkspaceId: () => 'ws-1',
      logger,
    });

    const preventDefault = vi.fn();
    handler({
      preventDefault,
      dataTransfer: { files: [pngFile()] },
    } as unknown as DragEvent);

    expect(preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(setImage).toHaveBeenCalledWith({ src: saveResult.url }));
    expect(mockedRequest).toHaveBeenCalledWith(
      'note.saveAsset',
      expect.objectContaining({ workspaceId: 'ws-1', originalName: 'pic.png' }),
    );
  });
});
