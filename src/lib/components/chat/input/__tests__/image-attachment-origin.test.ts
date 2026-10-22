import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock(
  '$lib/client/live/backend-transport',
  async () =>
    (await import('../../../../../test/mocks/backend-transport.mock')).mockBackendTransportModule,
);
vi.mock('../attachment-placement', async (original) => ({
  ...(await original()),
  MAX_REMOTE_ATTACHMENT_BYTES: 3,
  UPLOAD_CHUNK_BYTES: 3,
}));
import {
  installMockBackend,
  resetMockBackend,
} from '../../../../../test/mocks/backend-transport.mock';
import { placeImageAttachment } from '../image-attachment-placement';
afterEach(resetMockBackend);
function setup(fail = false) {
  const backend = installMockBackend();
  backend.onRequest('file.attachmentUpload.begin', () => ({
    uploadId: 'opaque-upload',
    maxChunkBytes: 3,
  }));
  backend.onRequest('file.attachmentUpload.chunk', () => {
    if (fail) throw new Error('chunk rejected');
    return { uploadId: 'opaque-upload', seq: 0, receivedBytes: 3 };
  });
  backend.onRequest('file.attachmentUpload.commit', () => ({
    ok: true,
    attachmentId: 'att',
    path: 'a.png',
    fileName: 'a.png',
    size: 6,
    uploadedAt: '2026-09-28T00:00:00Z',
  }));
  backend.onRequest('file.attachmentUpload.abort', () => ({
    uploadId: 'opaque-upload',
    aborted: true,
  }));
  return backend;
}
describe('Image upload origin', () => {
  it('carries the begin workspace through real chunk and commit adapters', async () => {
    const b = setup();
    await placeImageAttachment('workspace-a', 'a.png', {
      data: btoa('abcdef'),
      mimeType: 'image/png',
    });
    expect(
      b.requests
        .filter(
          (r) =>
            r.method === 'file.attachmentUpload.chunk' ||
            r.method === 'file.attachmentUpload.commit',
        )
        .map((r) => r.params?.workspaceId),
    ).toEqual(['workspace-a', 'workspace-a', 'workspace-a']);
  });
  it('carries the begin workspace through real abort adapter', async () => {
    const b = setup(true);
    await expect(
      placeImageAttachment('workspace-a', 'a.png', { data: btoa('abcdef'), mimeType: 'image/png' }),
    ).rejects.toThrow('chunk rejected');
    expect(b.requests.find((r) => r.method === 'file.attachmentUpload.abort')?.params).toEqual({
      uploadId: 'opaque-upload',
      workspaceId: 'workspace-a',
    });
  });
});

it('recovers a lost commit reply in the captured workspace after focus changes', async () => {
  const backend = setup();
  let finishBegin!: () => void;
  backend.onRequest(
    'file.attachmentUpload.begin',
    () =>
      new Promise((resolve) => {
        finishBegin = () => resolve({ uploadId: 'opaque-upload', maxChunkBytes: 3 });
      }),
  );
  backend.onRequest('file.attachmentUpload.commit', () => {
    throw Object.assign(new Error('reply lost'), { code: 'TRANSPORT_ERROR' });
  });
  backend.onRequest('file.getAttachmentInfo', () => ({
    attachmentId: 'recovered',
    path: 'a.png',
    fileName: 'a.png',
    size: 6,
    mimeType: 'image/png',
    uploadedAt: '2026-09-28T00:00:00Z',
    exists: true,
  }));
  let selectedWorkspace = 'workspace-a';
  const placement = placeImageAttachment(selectedWorkspace, 'a.png', {
    data: btoa('abcdef'),
    mimeType: 'image/png',
    idempotencyKey: 'image-key',
  });
  await vi.waitFor(() => expect(finishBegin).toBeTypeOf('function'));
  selectedWorkspace = 'workspace-b';
  finishBegin();
  expect((await placement).attachmentId).toBe('recovered');
  expect(selectedWorkspace).toBe('workspace-b');
  expect(backend.requests.every((request) => request.params?.workspaceId === 'workspace-a')).toBe(
    true,
  );
  expect(
    backend.requests.find((request) => request.method === 'file.getAttachmentInfo')?.params,
  ).toEqual({ workspaceId: 'workspace-a', idempotencyKey: 'image-key' });
  expect(backend.requests.some((request) => request.method === 'file.attachmentUpload.abort')).toBe(
    false,
  );
});
