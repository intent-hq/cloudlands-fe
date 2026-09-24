import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DOMPurify from 'dompurify';

const MARKDOWN = '# Worker fallback\n\n' + 'A paragraph that still renders. '.repeat(200);
const TIMEOUT_WARNING = '[markdown-worker] Worker timed out, falling back to main thread';
const FALLBACK_WARNING = '[markdown-worker] Failed to post to worker, falling back to main thread';

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
      vi.stubGlobal(
        'Worker',
        class {
          constructor() {
            if (failure === 'construction') throw new Error('Worker unavailable');
          }

          postMessage() {
            throw new Error('Worker postMessage failed');
          }
        },
      );
      // Keep the real warning output: the synchronous failure must remain visible.
      const warn = vi.spyOn(console, 'warn');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      const result = processMarkdownToHTML(MARKDOWN);
      // Finish the processor's zero-delay yield before DOM sanitization.
      await vi.advanceTimersByTimeAsync(0);
      expect(await result).toContain('<h1>Worker fallback</h1>');
      expect(
        warn.mock.calls.filter(([message]) => String(message).includes(FALLBACK_WARNING)),
      ).toHaveLength(1);

      // A settled fallback must not leave work that can log during worker shutdown.
      expect.soft(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(
        warn.mock.calls.filter(([message]) => String(message).includes(TIMEOUT_WARNING)),
      ).toHaveLength(0);
    },
  );

  it('still reports a timeout and falls back when a live worker never replies', async () => {
    const { processMarkdownToHTML } = await import('./markdown-processor');
    vi.stubGlobal(
      'Worker',
      class {
        postMessage() {}
      },
    );
    const warn = vi.spyOn(console, 'warn');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const result = processMarkdownToHTML(MARKDOWN);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.runOnlyPendingTimersAsync();

    expect(await result).toContain('<h1>Worker fallback</h1>');
    expect(
      warn.mock.calls.filter(([message]) => String(message).includes(TIMEOUT_WARNING)),
    ).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
