import { describe, expect, it, vi } from 'vitest';
import { createAttachmentTextTargetRead } from './backend-attachment-text-target';
import type { BackendTransport } from './backend-transport-types';
const registered = {
  attachmentId: 'id',
  exists: true,
  size: 129063439,
  mimeType: 'application/json',
  path: '.intent/attachments/trace.json',
};
describe('registered text attachment target', () => {
  it('returns only the daemon registered, confined JSON path', async () => {
    const request = vi.fn<BackendTransport['request']>().mockResolvedValue(registered);
    expect(await createAttachmentTextTargetRead(request)('ws', 'id')).toBe(registered.path);
    expect(request.mock.calls).toEqual([
      ['file.getAttachmentInfo', { workspaceId: 'ws', attachmentId: 'id' }],
    ]);
  });
  it.each([
    { attachmentId: 'other' },
    { exists: false },
    { mimeType: 'image/png' },
    { size: -1 },
    { path: '.intent/attachments/../secret.json' },
    { path: '/etc/a.json' },
    { path: '.intent/attachments/a.json:2' },
    { path: '.intent/attachments/a\u0000.json' },
    { path: '.intent/attachments/a.txt' },
  ])('rejects wrong identity or unsupported paths', async (delta) => {
    const request = vi
      .fn<BackendTransport['request']>()
      .mockResolvedValue({ ...registered, ...delta });
    await expect(createAttachmentTextTargetRead(request)('ws', 'id')).rejects.toThrow();
  });
});
