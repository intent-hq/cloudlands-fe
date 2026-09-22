/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentBlock } from '$shared/types';
import { warmImport } from '../../../../test/warm-import';
import { LiveBlockCache } from '../live-block-cache';

vi.mock('$lib/components/markdown/MarkdownViewer.svelte', async () => ({
  default: (await import('./mocks/MarkdownViewerStub.svelte')).default,
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

warmImport(() => import('../StreamingMessageContent.svelte'));

const textBlock = (id: string, text: string): ContentBlock => ({ type: 'text', id, text });

describe('StreamingMessageContent live text parsing', () => {
  it('renders the latest value throughout a long stream and after completion', async () => {
    const Component = (await import('../StreamingMessageContent.svelte')).default;
    const reconcile = vi.spyOn(LiveBlockCache.prototype, 'reconcile');
    let text = '';
    const view = render(Component, {
      props: { content: [textBlock('text-1', 'starting')], isStreaming: true },
    });

    for (let update = 0; update < 100; update++) {
      text += 'stream payload '.padEnd(1024, 'x');
      await view.rerender({ content: [textBlock('text-1', text)], isStreaming: true });
    }

    expect(screen.getByTestId('markdown-viewer').textContent).toBe(text);
    const cache = reconcile.mock.instances.at(-1) as unknown as LiveBlockCache<
      string,
      string | null,
      unknown
    >;
    expect(cache.size).toBe(1);
    expect(cache.retainedInputSize).toBe(text.length);

    await view.rerender({ content: [textBlock('text-1', text)], isStreaming: false });
    expect(screen.getByTestId('markdown-viewer').textContent).toBe(text);
    expect(cache.size).toBe(1);
    expect(cache.retainedInputSize).toBe(text.length);

    view.unmount();
    expect(cache.size).toBe(0);
    expect(cache.retainedInputSize).toBe(0);
  });

  it('keeps duplicate text blocks distinct across reorder, change, and removal', async () => {
    const Component = (await import('../StreamingMessageContent.svelte')).default;
    const view = render(Component, {
      props: {
        content: [textBlock('a', 'same text'), textBlock('b', 'same text')],
        isStreaming: true,
      },
    });
    expect(screen.getAllByTestId('markdown-viewer').map((node) => node.textContent)).toEqual([
      'same text',
      'same text',
    ]);

    await view.rerender({
      content: [textBlock('b', 'changed text'), textBlock('a', 'same text')],
      isStreaming: true,
    });
    expect(screen.getAllByTestId('markdown-viewer').map((node) => node.textContent)).toEqual([
      'changed text',
      'same text',
    ]);

    await view.rerender({ content: [textBlock('b', 'changed text')], isStreaming: true });
    expect(screen.getAllByTestId('markdown-viewer').map((node) => node.textContent)).toEqual([
      'changed text',
    ]);
  });

  it('updates setup-script behavior while keeping suggested prompts out of prose', async () => {
    const Component = (await import('../StreamingMessageContent.svelte')).default;
    const onSetupScriptGenerated = vi.fn();
    const content = [
      textBlock(
        'setup',
        '<setup_script name="Bootstrap" description="Prepare workspace">echo ready</setup_script>\nVisible detail\n<!-- suggested-prompts\nRun tests.\nOpen PR.\n-->',
      ),
    ];
    render(Component, { props: { content, isStreaming: true, onSetupScriptGenerated } });

    expect(screen.getByText('Bootstrap')).toBeTruthy();
    expect(screen.getByTestId('markdown-viewer').textContent).toContain('Visible detail');
    expect(document.body.textContent).not.toContain('suggested-prompts');
    await fireEvent.click(screen.getByRole('button', { name: /use script/i }));
    expect(onSetupScriptGenerated).toHaveBeenCalledWith({
      name: 'Bootstrap',
      description: 'Prepare workspace',
      content: 'echo ready',
    });
  });
});
