import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DOMPurify from 'dompurify';
import type { MarkdownWorkerRequest, MarkdownWorkerResponse } from './markdown-worker';

const MARKDOWN = '# Worker fallback\n\n' + 'A paragraph that still renders. '.repeat(200);
const TIMEOUT_WARNING = '[markdown-worker] Worker timed out, falling back to main thread';
const FALLBACK_WARNING = '[markdown-worker] Failed to post to worker, falling back to main thread';
const PARSE_ERROR = '[markdown-processor] Failed to parse markdown:';

function startRequest(run: () => Promise<string>) {
  // Observe real callback retention without exposing a test-only production API.
  // This spy calls through and is removed before any asynchronous processing.
  const registrations = vi.spyOn(Map.prototype, 'set');
  try {
    const result = run();
    const requests = registrations.mock.calls.flatMap(([id, value], index) =>
      typeof id === 'number' &&
      value !== null &&
      typeof value === 'object' &&
      typeof value.resolve === 'function' &&
      typeof value.reject === 'function'
        ? [{ id, callbacks: registrations.mock.contexts[index] as Map<number, unknown> }]
        : [],
    );
    expect(requests).toHaveLength(1);
    return { result, ...requests[0] };
  } finally {
    registrations.mockRestore();
  }
}

function stubWorker(failure?: 'construction' | 'postMessage') {
  let reply: (data: MarkdownWorkerResponse) => void;
  class TestWorker {
    onmessage?: (event: { data: MarkdownWorkerResponse }) => void;

    constructor() {
      if (failure === 'construction') throw new Error('Worker unavailable');
      reply = (data) => this.onmessage?.({ data });
    }

    postMessage(_request: MarkdownWorkerRequest) {
      if (failure === 'postMessage') throw new Error('Worker postMessage failed');
    }
  }
  vi.stubGlobal('Worker', TestWorker);
  return {
    recover: () => {
      failure = undefined;
    },
    reply: (data: Pick<MarkdownWorkerResponse, 'id'> & Partial<MarkdownWorkerResponse>) =>
      reply({ html: null, error: null, ...data }),
  };
}

describe('markdown worker request lifecycle', () => {
  beforeEach(() => {
    // Give each case its own worker singleton, cache, and sanitizer hooks.
    vi.resetModules();
    vi.doMock('dompurify', () => ({ default: DOMPurify(window) }));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.doUnmock('dompurify');
  });

  it.each(['construction', 'postMessage'] as const)(
    'retires the request when worker %s throws and main-thread parsing succeeds',
    async (failure) => {
      const { processMarkdownToHTML } = await import('./markdown-processor');
      const worker = stubWorker(failure);
      // Keep the real warning output: the synchronous failure must remain visible.
      const warn = vi.spyOn(console, 'warn');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      const request = startRequest(() => processMarkdownToHTML(MARKDOWN));
      expect.soft(request.callbacks.has(request.id)).toBe(false);
      // Finish the processor's zero-delay yield before DOM sanitization.
      await vi.advanceTimersByTimeAsync(0);
      expect(await request.result).toContain('<h1>Worker fallback</h1>');
      expect(
        warn.mock.calls.filter(([message]) => String(message).includes(FALLBACK_WARNING)),
      ).toHaveLength(1);

      // A settled fallback must not leave work that can log during worker shutdown.
      expect.soft(vi.getTimerCount()).toBe(0);

      worker.recover();
      const next = startRequest(() => processMarkdownToHTML(`${MARKDOWN}\n\nNext request`));
      expect(next.id).not.toBe(request.id);
      worker.reply({ id: request.id, html: '<p>Late response</p>' });
      worker.reply({ id: request.id, error: 'Duplicate failure' });
      expect(next.callbacks.has(next.id)).toBe(true);
      worker.reply({ id: next.id, html: '<h1>Next request</h1>' });
      await vi.advanceTimersByTimeAsync(0);
      expect(await next.result).toBe('<h1>Next request</h1>');
      expect(next.callbacks.has(next.id)).toBe(false);
      expect(vi.getTimerCount()).toBe(0);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(
        warn.mock.calls.filter(([message]) => String(message).includes(TIMEOUT_WARNING)),
      ).toHaveLength(0);
    },
  );

  it('still reports a timeout and falls back when a live worker never replies', async () => {
    const { processMarkdownToHTML } = await import('./markdown-processor');
    const worker = stubWorker();
    const warn = vi.spyOn(console, 'warn');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const request = startRequest(() => processMarkdownToHTML(MARKDOWN));
    expect(request.callbacks.has(request.id)).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(request.callbacks.has(request.id)).toBe(false);
    worker.reply({ id: request.id, html: '<p>Too late</p>' });
    worker.reply({ id: request.id, error: 'Late worker failure' });
    await vi.runOnlyPendingTimersAsync();

    expect(await request.result).toContain('<h1>Worker fallback</h1>');
    expect(
      warn.mock.calls.filter(([message]) => String(message).includes(TIMEOUT_WARNING)),
    ).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['success', 'error'] as const)(
    'retires the request on a worker %s response and ignores duplicate replies',
    async (outcome) => {
      const { processMarkdownToHTML } = await import('./markdown-processor');
      const worker = stubWorker();
      const warn = vi.spyOn(console, 'warn');
      const error = vi.spyOn(console, 'error');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const request = startRequest(() => processMarkdownToHTML(MARKDOWN));
      expect(request.callbacks.has(request.id)).toBe(true);
      expect(vi.getTimerCount()).toBe(1);

      worker.reply(
        outcome === 'success'
          ? { id: request.id, html: '<h1>Worker result</h1><script>alert(1)</script>' }
          : { id: request.id, error: 'Worker parse failed' },
      );
      expect(request.callbacks.has(request.id)).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      worker.reply({ id: request.id, html: '<p>Duplicate response</p>' });
      worker.reply({ id: request.id, error: 'Duplicate failure' });
      await vi.advanceTimersByTimeAsync(0);
      const html = await request.result;

      if (outcome === 'success') {
        expect(html).toBe('<h1>Worker result</h1>');
        expect(error).not.toHaveBeenCalled();
      } else {
        expect(html).toBe(`<p>${MARKDOWN}</p>`);
        expect(
          error.mock.calls.filter(([message]) => String(message).includes(PARSE_ERROR)),
        ).toEqual([
          [
            expect.stringContaining(PARSE_ERROR),
            expect.objectContaining({ message: 'Worker parse failed' }),
          ],
        ]);
      }
      await vi.advanceTimersByTimeAsync(30_000);
      expect(warn).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['construction', 'postMessage', 'timeout'] as const)(
    'retires the request before fallback parsing rejects after %s failure',
    async (failure) => {
      const { processMarkdownToHTML } = await import('./markdown-processor');
      const markedModule = await import('./tiptap-task-list-extension');
      const marked = markedModule.createTiptapTaskListMarked();
      const fallback = Promise.withResolvers<string>();
      const parse = vi.spyOn(marked, 'parse').mockReturnValueOnce(fallback.promise);
      vi.spyOn(markedModule, 'createTiptapTaskListMarked').mockReturnValue(marked);
      stubWorker(failure === 'timeout' ? undefined : failure);
      const warn = vi.spyOn(console, 'warn');
      const error = vi.spyOn(console, 'error');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      const request = startRequest(() => processMarkdownToHTML(MARKDOWN));
      if (failure === 'timeout') await vi.advanceTimersByTimeAsync(30_000);
      expect(parse).toHaveBeenCalledOnce();
      expect.soft(request.callbacks.has(request.id)).toBe(false);
      expect.soft(vi.getTimerCount()).toBe(0);

      const parseError = new Error('Main-thread parsing failed');
      fallback.reject(parseError);
      expect(await request.result).toBe(`<p>${MARKDOWN}</p>`);
      expect(error.mock.calls.filter(([message]) => String(message).includes(PARSE_ERROR))).toEqual(
        [[expect.stringContaining(PARSE_ERROR), parseError]],
      );
      expect(warn.mock.calls[0][0]).toContain(
        failure === 'timeout' ? TIMEOUT_WARNING : FALLBACK_WARNING,
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(warn).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
