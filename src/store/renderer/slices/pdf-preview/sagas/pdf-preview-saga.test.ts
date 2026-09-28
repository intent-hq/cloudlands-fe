import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPdf, PdfReadError } from '$features/file/services/read-pdf';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  pdfPreviewRequested as request,
  pdfPreviewReady as ready,
  pdfPreviewFailed as failed,
  pdfPreviewReleased as release,
} from '../pdf-preview-slice';
import { pdfPreviewSaga } from './pdf-preview-saga';

vi.mock('$features/file/services/read-pdf', async (original) => ({
  ...(await original<typeof import('$features/file/services/read-pdf')>()),
  readPdf: vi.fn(),
}));
const read = vi.mocked(readPdf);
let task: Task;
let channel: ReturnType<typeof stdChannel>;
let dispatched: { type: string }[];
const createUrl = vi.fn();
const revokeUrl = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
  createUrl.mockReturnValue('blob:pdf');
  channel = stdChannel();
  dispatched = [];
  task = runSaga(
    { channel, dispatch: (action: { type: string }) => dispatched.push(action) },
    pdfPreviewSaga,
  );
});
afterEach(() => task.cancel());
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('PDF read lifecycle', () => {
  it('reads the owning workspace and exact path, retaining its Blob only until release', async () => {
    read.mockResolvedValue(new Uint8Array([255, 254, 1]));
    channel.put(request('view', 'req', 'remote-ws', 'docs/résumé #1%.pdf'));
    await settle();
    expect(read.mock.calls[0].slice(0, 2)).toEqual(['remote-ws', 'docs/résumé #1%.pdf']);
    expect(createUrl.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(dispatched).toEqual([ready('view', 'req', 'blob:pdf')]);
    channel.put(release('another', 'req'));
    expect(revokeUrl).not.toHaveBeenCalled();
    channel.put(release('view', 'req'));
    expect(revokeUrl).toHaveBeenCalledWith('blob:pdf');
    expect(read.mock.calls[0][2].aborted).toBe(true);
  });

  it.each(['missing', 'large', 'load'] as const)(
    'publishes %s errors and supports a fresh retry',
    async (reason) => {
      read
        .mockRejectedValueOnce(new PdfReadError(reason))
        .mockResolvedValueOnce(new Uint8Array([1]));
      channel.put(request('view', 'old', 'ws', 'a.pdf'));
      await settle();
      expect(dispatched).toEqual([failed('view', 'old', reason)]);
      channel.put(request('view', 'retry', 'ws', 'a.pdf'));
      await settle();
      expect(dispatched[1]).toEqual(ready('view', 'retry', 'blob:pdf'));
    },
  );

  it.each(['close', 'replace', 'workspace', 'saga'] as const)(
    'cancels a pending read on %s and ignores its late bytes',
    async (kind) => {
      let finish!: (bytes: Uint8Array<ArrayBuffer>) => void;
      read.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      channel.put(request('view', 'old', 'ws', 'a.pdf'));
      const signal = read.mock.calls[0][2];
      if (kind === 'close') channel.put(release('view', 'old'));
      if (kind === 'replace') {
        read.mockReturnValue(new Promise(() => {}));
        channel.put(request('view', 'new', 'ws', 'b.pdf'));
      }
      if (kind === 'workspace') channel.put(workspaceUnmounted('ws'));
      if (kind === 'saga') task.cancel();
      expect(signal.aborted).toBe(true);
      finish(new Uint8Array([1]));
      await settle();
      expect(createUrl).not.toHaveBeenCalled();
      expect(dispatched).toEqual([]);
    },
  );

  it('releases every completed Blob when the saga stops', async () => {
    read.mockResolvedValue(new Uint8Array([1]));
    createUrl.mockReturnValueOnce('blob:one').mockReturnValueOnce('blob:two');
    channel.put(request('one', 'r1', 'ws', 'a.pdf'));
    channel.put(request('two', 'r2', 'ws', 'b.pdf'));
    await settle();
    expect(dispatched).toHaveLength(2);
    task.cancel();
    expect(revokeUrl.mock.calls).toEqual([['blob:one'], ['blob:two']]);
  });
});
