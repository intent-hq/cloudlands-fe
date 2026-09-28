import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backendRequest } from '$lib/client/live/backend-transport';
import { BackendError } from '$lib/client/live/backend-transport-types';
import { readPdf } from './read-pdf';

vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));
const request = vi.mocked(backendRequest);
beforeEach(() => vi.resetAllMocks());
const signal = () => new AbortController().signal;

describe('binary PDF loading', () => {
  it('requests offset windows on the selected backend without decoding UTF-8', async () => {
    request.mockResolvedValueOnce({ content: '/wAB', bytesRead: 3, size: 5 });
    request.mockResolvedValueOnce({ content: 'gP4=', bytesRead: 2, size: 5 });
    expect(await readPdf('remote-workspace', 'docs/résumé #1%.PDF', signal())).toEqual(
      new Uint8Array([255, 0, 1, 128, 254]),
    );
    expect(request.mock.calls).toEqual([
      [
        'file.readChunk',
        {
          workspaceId: 'remote-workspace',
          path: 'docs/résumé #1%.PDF',
          offset: 0,
          length: 1048576,
        },
      ],
      [
        'file.readChunk',
        {
          workspaceId: 'remote-workspace',
          path: 'docs/résumé #1%.PDF',
          offset: 3,
          length: 1048576,
        },
      ],
    ]);
  });

  it.each([
    [{ content: '', bytesRead: 0, size: 1 }, 'load'],
    [{ content: 'AA==', bytesRead: 2, size: 2 }, 'load'],
    [{ content: '%%%%', bytesRead: 1, size: 1 }, 'load'],
    [{ content: '', bytesRead: 0, size: 67108865 }, 'large'],
    [{ content: '', bytesRead: 0, size: -1 }, 'load'],
  ])('rejects inconsistent, invalid, or excessive data: %j', async (chunk, reason) => {
    request.mockResolvedValue(chunk);
    await expect(readPdf('ws', 'a.pdf', signal())).rejects.toMatchObject({ reason });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects a file that changes size between chunks', async () => {
    request.mockResolvedValueOnce({ content: 'AA==', bytesRead: 1, size: 2 });
    request.mockResolvedValueOnce({ content: 'AA==', bytesRead: 1, size: 3 });
    await expect(readPdf('ws', 'a.pdf', signal())).rejects.toMatchObject({ reason: 'load' });
  });

  it.each([
    [
      new BackendError({
        code: 'INTERNAL_ERROR',
        rpcCode: -32603,
        message: 'No such file or directory (os error 2)',
      }),
      'missing',
    ],
    [
      new BackendError({
        code: 'INTERNAL_ERROR',
        rpcCode: -32603,
        message: 'Permission denied (os error 13)',
      }),
      'load',
    ],
    [new BackendError({ code: 'TRANSPORT_ERROR', message: 'connection closed' }), 'load'],
    [new Error('not found'), 'load'],
  ])('distinguishes absence from transport and permission failures', async (error, reason) => {
    request.mockRejectedValue(error);
    await expect(readPdf('ws', 'a.pdf', signal())).rejects.toMatchObject({ reason });
  });

  it('stops reading after the tab is closed while a chunk is in flight', async () => {
    const abort = new AbortController();
    request.mockImplementation(async () => {
      abort.abort();
      return { content: 'AA==', bytesRead: 1, size: 2 };
    });
    await expect(readPdf('ws', 'a.pdf', abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
