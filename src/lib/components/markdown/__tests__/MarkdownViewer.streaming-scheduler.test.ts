/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownViewer from '../MarkdownViewer.svelte';

const processMarkdownToHTML = vi.hoisted(() => vi.fn());
vi.mock('$lib/utils/markdown-processor', () => ({ processMarkdownToHTML }));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
  await tick();
}

describe('MarkdownViewer streaming scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    processMarkdownToHTML.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('enforces a 150ms cadence and coalesces each interval to the latest input', async () => {
    const parsedAt: number[] = [];
    processMarkdownToHTML.mockImplementation(async (text: string) => {
      parsedAt.push(performance.now());
      return `<p>${text}</p>`;
    });
    const view = render(MarkdownViewer, {
      props: { content: '**initial**', isStreaming: true, workspaceId: 'ws-1' },
    });
    await flushAsync();

    await vi.advanceTimersByTimeAsync(40);
    await view.rerender({ content: '**discarded**' });
    await vi.advanceTimersByTimeAsync(40);
    await view.rerender({ content: '**latest at 150**' });
    await vi.advanceTimersByTimeAsync(69);
    expect(processMarkdownToHTML).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await flushAsync();
    expect(processMarkdownToHTML).toHaveBeenCalledTimes(2);
    expect(processMarkdownToHTML.mock.calls[1]?.[0]).toBe('**latest at 150**');

    await view.rerender({ content: '**discarded again**' });
    await vi.advanceTimersByTimeAsync(150);
    await flushAsync();
    expect(processMarkdownToHTML).toHaveBeenCalledTimes(3);
    expect(parsedAt).toEqual([0, 150, 300]);
    expect(view.container.textContent).toContain('**discarded again**');
  });

  it('keeps one parse in flight and renders only the latest trailing request', async () => {
    const operations: Array<{ text: string; result: Deferred<string> }> = [];
    let active = 0;
    let peakActive = 0;
    processMarkdownToHTML.mockImplementation((text: string) => {
      const result = deferred<string>();
      active += 1;
      peakActive = Math.max(peakActive, active);
      void result.promise.finally(() => (active -= 1));
      operations.push({ text, result });
      return result.promise;
    });
    const view = render(MarkdownViewer, {
      props: { content: '**old**', isStreaming: true },
    });
    await flushAsync();
    await view.rerender({ content: '**superseded**' });
    await view.rerender({ content: '**newest**' });
    await vi.advanceTimersByTimeAsync(500);

    expect(operations).toHaveLength(1);
    operations[0].result.resolve('<p>stale old result</p>');
    await flushAsync();
    expect(view.container.textContent).not.toContain('stale old result');
    expect(operations.map(({ text }) => text)).toEqual(['**old**', '**newest**']);

    operations[1].result.resolve('<p>latest result</p>');
    await flushAsync();
    expect(view.container.textContent).toContain('latest result');
    expect(peakActive).toBe(1);
  });

  it('shows monotonic prefix progress when parsing is slower than the input stream', async () => {
    const operations: Array<{ text: string; result: Deferred<string> }> = [];
    processMarkdownToHTML.mockImplementation((text: string) => {
      const result = deferred<string>();
      operations.push({ text, result });
      return result.promise;
    });
    const view = render(MarkdownViewer, {
      props: { content: 'A', isStreaming: true, workspaceId: 'ws-1' },
    });
    await flushAsync();
    await view.rerender({ content: 'AB' });
    await vi.advanceTimersByTimeAsync(200);

    operations[0].result.resolve('<p>rendered A</p>');
    await flushAsync();
    expect(view.container.textContent).toContain('rendered A');
    expect(operations.map(({ text }) => text)).toEqual(['A', 'AB']);

    await view.rerender({ content: 'ABC' });
    await vi.advanceTimersByTimeAsync(200);
    operations[1].result.resolve('<p>rendered AB</p>');
    await flushAsync();
    expect(view.container.textContent).toContain('rendered AB');
    expect(operations.map(({ text }) => text)).toEqual(['A', 'AB', 'ABC']);

    operations[2].result.resolve('<p>rendered ABC</p>');
    await flushAsync();
    expect(view.container.textContent).toContain('rendered ABC');
  });

  it('recovers from a rejected stale parse without exposing its fallback', async () => {
    const operations: Deferred<string>[] = [];
    processMarkdownToHTML.mockImplementation(() => {
      const result = deferred<string>();
      operations.push(result);
      return result.promise;
    });
    const view = render(MarkdownViewer, {
      props: { content: '**failing old**', isStreaming: true },
    });
    await flushAsync();
    await view.rerender({ content: '**recovered latest**' });
    await vi.advanceTimersByTimeAsync(200);

    operations[0].reject(new Error('synthetic parse failure'));
    await flushAsync();
    expect(view.container.textContent).not.toContain('failing old');
    expect(operations).toHaveLength(2);

    operations[1].resolve('<p>recovered latest</p>');
    await flushAsync();
    expect(view.container.textContent).toContain('recovered latest');
  });

  it('invalidates stale results when markdown processing context changes', async () => {
    const operations: Array<{ options: Record<string, unknown>; result: Deferred<string> }> = [];
    processMarkdownToHTML.mockImplementation((_text: string, options: Record<string, unknown>) => {
      const result = deferred<string>();
      operations.push({ options, result });
      return result.promise;
    });
    const view = render(MarkdownViewer, {
      props: {
        content: '```mermaid\nA --> B\n```',
        workspaceId: 'ws-old',
        taskBlockRenderMode: 'placeholder',
      },
    });
    await flushAsync();
    await view.rerender({
      workspaceId: 'ws-new',
      taskBlockRenderMode: 'content',
      renderRichFencesAsCode: true,
    });

    operations[0].result.resolve('<p>stale context</p>');
    await flushAsync();
    expect(view.container.textContent).not.toContain('stale context');
    expect(operations).toHaveLength(2);
    expect(operations[1].options).toMatchObject({
      workspaceId: 'ws-new',
      taskBlockRenderMode: 'content',
      renderRichFencesAsCode: true,
    });
    expect(operations[1].options.workspaceFileVersion).toBe(
      operations[0].options.workspaceFileVersion,
    );

    operations[1].result.resolve('<p>latest context</p>');
    await flushAsync();
    expect(view.container.textContent).toContain('latest context');
  });

  it('queues final static content immediately behind an active streaming parse', async () => {
    const operations: Array<{ text: string; result: Deferred<string> }> = [];
    processMarkdownToHTML.mockImplementation((text: string) => {
      const result = deferred<string>();
      operations.push({ text, result });
      return result.promise;
    });
    const view = render(MarkdownViewer, { props: { content: '**steady**' } });
    await flushAsync();
    operations[0].result.resolve('<p>steady result</p>');
    await flushAsync();

    await view.rerender({ isStreaming: true });
    expect(view.container.textContent).toContain('steady result');
    expect(operations).toHaveLength(1);

    await view.rerender({ content: '**partial**' });
    await vi.advanceTimersByTimeAsync(150);
    expect(operations).toHaveLength(2);
    await view.rerender({ content: '**final**', isStreaming: false });
    expect(view.container.textContent).toContain('steady result');

    operations[1].result.resolve('<p>stale partial</p>');
    await flushAsync();
    expect(operations.map(({ text }) => text)).toEqual(['**steady**', '**partial**', '**final**']);
    expect(view.container.textContent).toContain('steady result');

    operations[2].result.resolve('<p>final result</p>');
    await flushAsync();
    expect(view.container.textContent).toContain('final result');
  });

  it('invalidates parsing across simple and video render-mode transitions', async () => {
    const operations: Deferred<string>[] = [];
    processMarkdownToHTML.mockImplementation(() => {
      const result = deferred<string>();
      operations.push(result);
      return result.promise;
    });
    const view = render(MarkdownViewer, { props: { content: 'plain text' } });
    await view.rerender({ isStreaming: true });
    expect(view.container.textContent).toContain('plain text');
    expect(operations).toHaveLength(1);
    operations[0].resolve('<p>parsed plain text</p>');
    await flushAsync();

    const videoMarkdown = '![demo](intent://local/file/out/demo.mp4)';
    await view.rerender({ content: videoMarkdown, workspaceId: 'ws-video' });
    expect(view.container.querySelector('video')?.getAttribute('src')).toBe(
      'workspace-file://ws-video/out/demo.mp4',
    );
    expect(processMarkdownToHTML).toHaveBeenCalledTimes(1);

    await view.rerender({ workspaceId: undefined, isStreaming: false });
    expect(view.container.textContent).toContain('demo');
    expect(operations).toHaveLength(2);
    operations[1].resolve('<p>parsed portable video link</p>');
    await flushAsync();
    expect(view.container.textContent).toContain('parsed portable video link');
  });

  it('clears empty streaming content and cancels a queued update on unmount', async () => {
    processMarkdownToHTML.mockImplementation(async (text: string) => `<p>${text}</p>`);
    const view = render(MarkdownViewer, {
      props: { content: '**visible**', isStreaming: true, workspaceId: 'ws-old' },
    });
    await flushAsync();
    expect(view.container.textContent).toContain('**visible**');

    await view.rerender({ content: '', workspaceId: 'ws-new' });
    expect(view.container.textContent?.trim()).toBe('');
    await view.rerender({ content: '**visible**' });
    await vi.advanceTimersByTimeAsync(150);
    await flushAsync();
    expect(processMarkdownToHTML).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).toContain('**visible**');

    await view.rerender({ content: '**never parsed**' });
    expect(processMarkdownToHTML).toHaveBeenCalledTimes(2);

    await view.unmount();
    await vi.advanceTimersByTimeAsync(1000);
    expect(processMarkdownToHTML).toHaveBeenCalledTimes(2);
  });

  it('ignores completion after unmount and does not schedule its trailing request', async () => {
    const first = deferred<string>();
    processMarkdownToHTML.mockReturnValue(first.promise);
    const view = render(MarkdownViewer, {
      props: { content: '**in flight**', isStreaming: true },
    });
    await flushAsync();
    await view.rerender({ content: '**trailing**' });
    await view.unmount();

    first.resolve('<p>late completion</p>');
    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(processMarkdownToHTML).toHaveBeenCalledTimes(1);
  });
});
