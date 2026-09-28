import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPdf, PdfReadError } from '../services/read-pdf';
import { loadPdfDocument } from '../services/pdf-renderer';
import PdfViewer from './PdfViewer.svelte';

vi.mock('../services/read-pdf', async (original) => ({
  ...(await original<typeof import('../services/read-pdf')>()),
  readPdf: vi.fn(),
}));
vi.mock('../services/pdf-renderer', () => ({ loadPdfDocument: vi.fn() }));
const read = vi.mocked(readPdf);
const load = vi.mocked(loadPdfDocument);
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

function loadingTask(promise: Promise<unknown>) {
  const destroy = vi.fn().mockResolvedValue(undefined);
  load.mockReturnValue({ promise, destroy } as unknown as ReturnType<typeof loadPdfDocument>);
  return destroy;
}

function document() {
  const cancel = vi.fn();
  const renderPage = vi.fn(() => ({ promise: Promise.resolve(), cancel }));
  const getPage = vi.fn().mockResolvedValue({
    getViewport: () => ({ width: 300, height: 200 }),
    render: renderPage,
  });
  return { numPages: 2, getPage, cancel, renderPage };
}

describe('PDF viewer lifecycle', () => {
  it.each(['missing', 'large', 'load'] as const)(
    'shows %s failures and retries the binary read',
    async (reason) => {
      read.mockRejectedValue(new PdfReadError(reason));
      render(PdfViewer, { workspaceId: 'ws', filePath: 'report.pdf' });
      await screen.findByRole('alert');
      expect(load).not.toHaveBeenCalled();
      await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    },
  );

  it.each(['PasswordException', 'InvalidPDFException'])(
    'reports renderer rejection %s',
    async (name) => {
      read.mockResolvedValue(new Uint8Array([0]));
      load.mockImplementation(
        () =>
          ({
            promise: Promise.reject(Object.assign(new Error('invalid'), { name })),
            destroy: vi.fn().mockResolvedValue(undefined),
          }) as unknown as ReturnType<typeof loadPdfDocument>,
      );
      render(PdfViewer, { workspaceId: 'ws', filePath: 'report.pdf' });
      await screen.findByRole('alert');
      expect(screen.queryByRole('img')).toBeNull();
    },
  );

  it('aborts a pending read on close and ignores its late response', async () => {
    let finish!: (bytes: Uint8Array<ArrayBuffer>) => void;
    read.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(PdfViewer, { workspaceId: 'ws', filePath: 'report.pdf' });
    await waitFor(() => expect(read).toHaveBeenCalledOnce());
    view.unmount();
    expect(read.mock.calls[0][2].aborted).toBe(true);
    finish(new Uint8Array([1]));
    await Promise.resolve();
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
  });

  it('destroys the old document and resets navigation when switching workspace/path', async () => {
    read.mockResolvedValue(new Uint8Array([1]));
    const first = document();
    const destroy = loadingTask(Promise.resolve(first));
    const view = render(PdfViewer, { workspaceId: 'local', filePath: 'first.pdf' });
    await waitFor(() => expect(first.renderPage).toHaveBeenCalled());
    await fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(first.getPage).toHaveBeenLastCalledWith(2));
    const second = document();
    const destroySecond = loadingTask(Promise.resolve(second));
    await view.rerender({ workspaceId: 'remote', filePath: 'second.pdf' });
    await waitFor(() => expect(second.getPage).toHaveBeenCalledWith(1));
    expect(destroy).toHaveBeenCalledOnce();
    expect(first.cancel).toHaveBeenCalled();
    expect(read.mock.calls[1].slice(0, 2)).toEqual(['remote', 'second.pdf']);
    view.unmount();
    expect(destroySecond).toHaveBeenCalledOnce();
    expect(second.cancel).toHaveBeenCalled();
  });
});
