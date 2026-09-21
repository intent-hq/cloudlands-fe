/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownViewer from '../MarkdownViewer.svelte';

const processMarkdown = vi.hoisted(() => vi.fn());
vi.mock('$lib/utils/markdown-processor', () => ({ processMarkdownToHTML: processMarkdown }));

async function settle() {
  await vi.advanceTimersByTimeAsync(0);
  await tick();
}

function deferred() {
  let resolve!: (html: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'performance',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
  vi.advanceTimersByTime(1000);
  processMarkdown.mockReset().mockImplementation(async (content: string) => `<p>${content}</p>`);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('streaming Markdown scheduling', () => {
  it('renders immediately, then coalesces to the latest input every 150 ms', async () => {
    const view = render(MarkdownViewer, { content: 'first', isStreaming: true });
    await settle();
    expect(view.container.textContent?.trim()).toBe('first');
    await vi.advanceTimersByTimeAsync(50);
    await view.rerender({ content: 'second' });
    await vi.advanceTimersByTimeAsync(50);
    await view.rerender({ content: 'third' });
    await vi.advanceTimersByTimeAsync(49);
    expect(processMarkdown.mock.calls.map(([content]) => content)).toEqual(['first']);
    await vi.advanceTimersByTimeAsync(1);
    expect(view.container.textContent?.trim()).toBe('third');
    expect(processMarkdown.mock.calls.map(([content]) => content)).toEqual(['first', 'third']);
  });

  it('flushes final content immediately and cancels the pending streaming update', async () => {
    const view = render(MarkdownViewer, { content: 'first', isStreaming: true });
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    await view.rerender({ content: 'pending' });
    await view.rerender({ content: '**complete**', isStreaming: false });
    await settle();
    expect(view.container.textContent?.trim()).toBe('**complete**');
    expect(processMarkdown.mock.calls.map(([content]) => content)).toEqual([
      'first',
      '**complete**',
    ]);
    expect(processMarkdown.mock.lastCall?.[1]).toMatchObject({ renderMath: true });
    await vi.advanceTimersByTimeAsync(300);
    expect(processMarkdown).toHaveBeenCalledTimes(2);
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores an obsolete render that later %ss',
    async (outcome) => {
      const old = deferred();
      processMarkdown.mockImplementationOnce(() => old.promise);
      const view = render(MarkdownViewer, { content: '**old**', isStreaming: true });
      await settle();
      await view.rerender({ content: '**new**', isStreaming: false });
      await settle();
      if (outcome === 'resolve') old.resolve('<p>obsolete result</p>');
      else old.reject(new Error('obsolete failure'));
      await settle();
      expect(view.container.textContent?.trim()).toBe('**new**');
    },
  );

  it('invalidates in-flight work as soon as a newer input is queued', async () => {
    const old = deferred();
    processMarkdown.mockImplementationOnce(() => old.promise);
    const view = render(MarkdownViewer, { content: 'first', isStreaming: true });
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    await view.rerender({ content: 'latest' });
    old.resolve('<p>obsolete result</p>');
    await settle();
    expect(view.container.textContent?.trim()).not.toContain('obsolete result');
    await vi.advanceTimersByTimeAsync(100);
    expect(view.container.textContent?.trim()).toBe('latest');
  });

  it('uses the latest rendering context when the trailing update starts', async () => {
    const view = render(MarkdownViewer, {
      content: '**same**',
      isStreaming: true,
      workspaceId: 'old',
    });
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    await view.rerender({
      workspaceId: 'new',
      renderRichFencesAsCode: true,
      taskBlockRenderMode: 'content',
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(processMarkdown.mock.lastCall?.[1]).toMatchObject({
      workspaceId: 'new',
      renderRichFencesAsCode: true,
      taskBlockRenderMode: 'content',
      renderMath: false,
    });
  });

  it('clears empty content and starts the next streaming session immediately', async () => {
    const view = render(MarkdownViewer, { content: '**first**', isStreaming: true });
    await settle();
    await view.rerender({ content: '' });
    await vi.advanceTimersByTimeAsync(150);
    expect(view.container.textContent?.trim()).toBe('');
    await view.rerender({ content: '**complete**', isStreaming: false });
    await settle();
    await view.rerender({ content: 'new session', isStreaming: true });
    await settle();
    expect(view.container.textContent?.trim()).toBe('new session');
  });

  it('escapes a failed render and can publish subsequent content', async () => {
    const unsafe = '<img src=x onerror="alert(1)">';
    processMarkdown.mockRejectedValueOnce(new Error('processing failed'));
    const view = render(MarkdownViewer, { content: unsafe, isStreaming: true });
    await settle();
    expect(view.container.textContent?.trim()).toBe(unsafe);
    expect(view.container.querySelector('img')).toBeNull();
    await view.rerender({ content: 'recovered' });
    await vi.advanceTimersByTimeAsync(150);
    expect(view.container.textContent?.trim()).toBe('recovered');
  });

  it('cancels queued work on unmount', async () => {
    const view = render(MarkdownViewer, { content: 'first', isStreaming: true });
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    await view.rerender({ content: 'pending' });
    view.unmount();
    await vi.advanceTimersByTimeAsync(300);
    expect(processMarkdown.mock.calls.map(([content]) => content)).toEqual(['first']);
  });
});
