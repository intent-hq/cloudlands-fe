import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPdf, PdfReadError } from '../services/read-pdf';
import { loadPdfDocument } from '../services/pdf-renderer';
import PdfViewer from './PdfViewer.svelte';
import { store as appStore } from '$store/renderer/store';
import { pdfPreviewSaga } from '$store/renderer/slices/pdf-preview/sagas/pdf-preview-saga';

vi.mock('$store/renderer/store', async () => {
  const { createPdfTestStore } = await import('../__tests__/pdf-test-store');
  return { store: createPdfTestStore() };
});

vi.mock('../services/read-pdf', async (original) => ({
  ...(await original<typeof import('../services/read-pdf')>()),
  readPdf: vi.fn(),
}));
vi.mock('../services/pdf-renderer', () => ({ loadPdfDocument: vi.fn() }));
const read = vi.mocked(readPdf);
const load = vi.mocked(loadPdfDocument);
let stop: () => void;
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => `blob:${crypto.randomUUID()}`),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  appStore.init();
  stop = appStore.runSaga(pdfPreviewSaga);
});
afterEach(() => {
  cleanup();
  stop();
});

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
    cleanup: vi.fn(),
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

function pageResource(renderPromise = Promise.resolve()) {
  return {
    getViewport: () => ({ width: 300, height: 200 }),
    render: vi.fn(() => ({ promise: renderPromise, cancel: vi.fn() })),
    cleanup: vi.fn(),
  };
}

describe('retired PDF page resources', () => {
  beforeEach(() => read.mockResolvedValue(new Uint8Array([1])));

  it('cleans a completed page on navigation and can render it again when returning', async () => {
    const pages = [pageResource(), pageResource()];
    loadingTask(
      Promise.resolve({ numPages: 2, getPage: (n: number) => Promise.resolve(pages[n - 1]) }),
    );
    render(PdfViewer, { workspaceId: 'ws', filePath: 'report.pdf' });
    await waitFor(() => expect(pages[0].render).toHaveBeenCalledOnce());
    await fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(pages[0].cleanup).toHaveBeenCalledOnce());
    await waitFor(() => expect(pages[1].render).toHaveBeenCalledOnce());
    await fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    await waitFor(() => expect(pages[1].cleanup).toHaveBeenCalledOnce());
    await waitFor(() => expect(pages[0].render).toHaveBeenCalledTimes(2));
  });

  it('waits for a cancelled render to settle before releasing its page', async () => {
    let finish!: () => void;
    const first = pageResource(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const second = pageResource();
    loadingTask(
      Promise.resolve({
        numPages: 2,
        getPage: (n: number) => Promise.resolve(n === 1 ? first : second),
      }),
    );
    render(PdfViewer, { workspaceId: 'ws', filePath: 'report.pdf' });
    await waitFor(() => expect(first.render).toHaveBeenCalledOnce());
    const task = first.render.mock.results[0].value;
    await fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(task.cancel).toHaveBeenCalledOnce();
    expect(first.cleanup).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(first.cleanup).toHaveBeenCalledOnce());
  });

  it('releases a page whose getPage resolves after the view closes', async () => {
    let finish!: (page: ReturnType<typeof pageResource>) => void;
    const getPage = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    loadingTask(Promise.resolve({ numPages: 1, getPage }));
    const view = render(PdfViewer, { workspaceId: 'ws', filePath: 'report.pdf' });
    await waitFor(() => expect(getPage).toHaveBeenCalledOnce());
    view.unmount();
    const page = pageResource();
    finish(page);
    await waitFor(() => expect(page.cleanup).toHaveBeenCalledOnce());
    expect(page.render).not.toHaveBeenCalled();
  });

  it('keeps a cached page alive while a newer zoom render still uses it', async () => {
    let finishOld!: () => void;
    const page = pageResource();
    page.render.mockReturnValueOnce({
      promise: new Promise((resolve) => {
        finishOld = resolve;
      }),
      cancel: vi.fn(),
    });
    loadingTask(Promise.resolve({ numPages: 1, getPage: () => Promise.resolve(page) }));
    const view = render(PdfViewer, { workspaceId: 'ws', filePath: 'report.pdf' });
    await waitFor(() => expect(page.render).toHaveBeenCalledOnce());
    await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(page.render).toHaveBeenCalledTimes(2));
    finishOld();
    await Promise.resolve();
    await Promise.resolve();
    expect(page.cleanup).not.toHaveBeenCalled();
    view.unmount();
    await waitFor(() => expect(page.cleanup).toHaveBeenCalledOnce());
  });
});
