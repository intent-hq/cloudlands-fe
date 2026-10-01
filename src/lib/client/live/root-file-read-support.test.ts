// protocol-version-ok-file: supported-generation boundary fixtures.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertScopedFileReadSupport } from '$shared/root-file-read-support';
import { backendRequest } from './backend-transport';
import { LiveFilesClient } from './live-files-client';
import { readPdf } from '$features/file/services/read-pdf';

vi.mock('./backend-transport', () => ({ backendRequest: vi.fn() }));
const request = vi.mocked(backendRequest);
afterEach(() => vi.resetAllMocks());

describe('registered-root file read support', () => {
  it.each([undefined, '11.0', '10.99', '12.0', 'invalid'])(
    'rejects unsupported or unknown sending connection %s for both readers',
    (protocolVersion) => {
      for (const method of ['file.read', 'file.readChunk']) {
        expect(() =>
          assertScopedFileReadSupport(method, { gitRootId: 'root-a' }, protocolVersion),
        ).toThrow();
      }
    },
  );
  it.each(['11.1', '11.2', '11.1.3'])(
    'accepts supported same-generation sending connection %s',
    (protocolVersion) => {
      for (const method of ['file.read', 'file.readChunk']) {
        expect(() =>
          assertScopedFileReadSupport(method, { gitRootId: 'root-a' }, protocolVersion),
        ).not.toThrow();
      }
    },
  );
  it('preserves unscoped and unrelated requests without root support', () => {
    expect(() => assertScopedFileReadSupport('file.read', {}, undefined)).not.toThrow();
    expect(() =>
      assertScopedFileReadSupport('file.readChunk', { gitRootId: ' ' }, undefined),
    ).not.toThrow();
    expect(() =>
      assertScopedFileReadSupport('git.status', { gitRootId: 'root-a' }, undefined),
    ).not.toThrow();
  });
  it('does not send renderer hello probes when reading scoped text or binary data', async () => {
    request
      .mockResolvedValueOnce('text')
      .mockResolvedValueOnce({ content: 'Ug==', size: 1, bytesRead: 1 });
    await new LiveFilesClient().read('ws', 'new.md', { gitRootId: 'root-a' });
    await readPdf('ws', 'new.pdf', new AbortController().signal, 'root-a');
    expect(request.mock.calls.map(([method]) => method)).toEqual(['file.read', 'file.readChunk']);
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
