/**
 * @vitest-environment jsdom
 *
 * Daemon-emitted reasoning renders live and persisted. The §7.1 `thinking`
 * block the daemon streams carries its reasoning in `text`
 * (`{ type: 'thinking', id: 'msg_1:0', text: '…' }`, intentd#973) — the render
 * sites must read it, not only the legacy `content` field the FE's own
 * <think>-tag parser produces.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentBlock } from '$shared/types';
import { warmImport } from '../../../../test/warm-import';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('$lib/components/markdown/MarkdownViewer.svelte', async () => ({
  default: (await import('./mocks/MarkdownViewerStub.svelte')).default,
}));

const storeState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => storeState.current, dispatch: vi.fn() });
});

afterEach(() => {
  storeState.current = {};
  cleanup();
});

warmImport(() => import('../StreamingMessageContent.svelte'));

/** Daemon-shaped thinking block (PROTOCOL §7.1). */
function thinking(id: string, text: string): ContentBlock {
  return { type: 'thinking', id, text };
}

async function renderStreaming(content: ContentBlock[], isStreaming: boolean) {
  const StreamingMessageContent = (await import('../StreamingMessageContent.svelte')).default;
  return render(StreamingMessageContent, { props: { content, isStreaming } });
}

describe('thinking blocks — StreamingMessageContent', () => {
  it('renders the daemon `text` field while streaming (auto-expanded)', async () => {
    await renderStreaming([thinking('msg_1:0', 'Checking the schema first')], true);

    const viewer = screen.getByTestId('markdown-viewer');
    expect(viewer.textContent).toContain('Checking the schema first');
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });

  it('renders a persisted headingless block with the localized collapsed fallback', async () => {
    await renderStreaming([thinking('msg_1:0', 'Checking the schema first')], false);

    const toggle = screen.getByRole('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent?.trim()).toBe('Reasoning');
    expect(screen.queryByTestId('markdown-viewer')).toBeNull();
    await fireEvent.click(toggle);
    expect(screen.getByTestId('markdown-viewer').textContent).toContain(
      'Checking the schema first',
    );
  });

  it('interleaves thinking and text blocks in stream order', async () => {
    await renderStreaming(
      [
        thinking('msg_1:0', 'First I reason'),
        { type: 'text', id: 'msg_1:1', text: 'Then I answer' },
      ],
      false,
    );

    const rendered = document.querySelectorAll('.content-block--thinking, .content-block--text');
    expect([...rendered].map((el) => el.className.includes('thinking'))).toEqual([true, false]);
  });

  it('still renders legacy `content`-bearing thinking blocks (FE <think> parser)', async () => {
    await renderStreaming([{ type: 'thinking', content: 'legacy reasoning' }], true);

    expect(screen.getByTestId('markdown-viewer').textContent).toContain('legacy reasoning');
  });

  it('renders thinking blocks regardless of the legacy visibility preference', async () => {
    storeState.current = { userPreferences: { showReasoningBlocks: false } };
    await renderStreaming(
      [
        thinking('msg_1:0', 'Hidden reasoning'),
        { type: 'text', id: 'msg_1:1', text: 'Visible answer' },
      ],
      false,
    );

    expect(document.querySelector('.content-block--thinking')).not.toBeNull();
    await fireEvent.click(screen.getByRole('button'));
    expect(document.body.textContent).toContain('Hidden reasoning');
    expect(document.querySelector('.content-block--text')?.textContent).toContain('Visible answer');
  });

  it('renders thinking blocks on a fresh preferences state', async () => {
    storeState.current = {};
    await renderStreaming([thinking('msg_1:0', 'Hidden reasoning')], true);

    expect(document.querySelector('.content-block--thinking')).not.toBeNull();
    expect(document.body.textContent).toContain('Hidden reasoning');
  });

  it('renders legacy <think>-tag reasoning regardless of the legacy preference', async () => {
    storeState.current = { userPreferences: { showReasoningBlocks: false } };
    await renderStreaming(
      [
        {
          type: 'text',
          id: 'msg_1:0',
          text: '<think>legacy hidden reasoning</think>Visible answer',
        },
      ],
      false,
    );

    expect(document.querySelector('.content-block--thinking')).not.toBeNull();
    await fireEvent.click(screen.getByRole('button'));
    expect(document.body.textContent).toContain('legacy hidden reasoning');
    expect(document.body.textContent).toContain('Visible answer');
  });

  it('still renders legacy <think>-tag reasoning when showReasoningBlocks is on', async () => {
    await renderStreaming(
      [
        {
          type: 'text',
          id: 'msg_1:0',
          text: '<think>legacy visible reasoning</think>Visible answer',
        },
      ],
      false,
    );

    expect(document.querySelector('.content-block--thinking')).not.toBeNull();
    await fireEvent.click(screen.getByRole('button'));
    expect(document.body.textContent).toContain('legacy visible reasoning');
  });
});
