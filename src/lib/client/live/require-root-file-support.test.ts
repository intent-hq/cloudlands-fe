// protocol-version-ok-file: fixtures exercise the negotiated registered-root file-read boundary.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendRequest } from './backend-transport';
import { LiveFilesClient } from './live-files-client';
import { readPdf } from '$features/file/services/read-pdf';

vi.mock('./backend-transport', () => ({ backendRequest: vi.fn() }));
const request = vi.mocked(backendRequest);
afterEach(() => vi.resetAllMocks());

describe('registered-root file read support', () => {
  it.each([undefined, '11.0', '10.99', '12.0', 'invalid'])(
    'rejects unsupported or unknown backend %s before reading text or chunks',
    async (protocolVersion) => {
      request.mockImplementation(async (method) =>
        method === 'client.hello' ? { protocolVersion } : 'WRONG PRIMARY CONTENT',
      );
      await expect(
        new LiveFilesClient().read('ws', 'new.md', { gitRootId: 'root-a' }),
      ).rejects.toThrow();
      await expect(
        readPdf('ws', 'new.pdf', new AbortController().signal, 'root-a'),
      ).rejects.toThrow();
      expect(request.mock.calls).toEqual([
        ['client.hello', {}],
        ['client.hello', {}],
      ]);
    },
  );

  it('rechecks support after a backend change and never retries without a root selector', async () => {
    request
      .mockResolvedValueOnce({ protocolVersion: '11.1' })
      .mockResolvedValueOnce('root content')
      .mockResolvedValueOnce({ protocolVersion: '11.0' });
    const client = new LiveFilesClient();
    expect(await client.read('ws', 'new.md', { gitRootId: 'root-a' })).toMatchObject({
      originalContent: 'root content',
    });
    await expect(client.read('ws', 'new.md', { gitRootId: 'root-a' })).rejects.toThrow();
    expect(request.mock.calls).toEqual([
      ['client.hello', {}],
      ['file.read', { workspaceId: 'ws', path: 'new.md', gitRootId: 'root-a' }],
      ['client.hello', {}],
    ]);
  });

  it('keeps ordinary workspace reads unchanged', async () => {
    request.mockResolvedValue('primary content');
    expect(await new LiveFilesClient().read('ws', 'new.md')).toMatchObject({
      originalContent: 'primary content',
    });
    expect(request).toHaveBeenCalledExactlyOnceWith('file.read', {
      workspaceId: 'ws',
      path: 'new.md',
    });
  });
});
