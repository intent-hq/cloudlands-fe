/**
 * @vitest-environment jsdom
 *
 * Daemon-emitted reasoning renders live and persisted. The §7.1 `thinking`
 * block the daemon streams carries its reasoning in `text`
 * (`{ type: 'thinking', id: 'msg_1:0', text: '…' }`, intentd#973) — the render
 * sites must read it, not only the legacy `content` field the FE's own
 * <think>-tag parser produces.
 */
import { cleanup, render, screen } from '@testing-library/svelte';
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

// Thinking blocks only render when the global showReasoningBlocks
// preference is on; these tests opt in unless they exercise the default.
const storeState = vi.hoisted(() => ({
  current: { userPreferences: { showReasoningBlocks: true } } as Record<string, unknown>,
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => storeState.current, dispatch: vi.fn() });
});

afterEach(() => {
  storeState.current = { userPreferences: { showReasoningBlocks: true } };
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

  it('renders a persisted thinking block collapsed with its text as the summary', async () => {
    await renderStreaming([thinking('msg_1:0', 'Checking the schema first')], false);

    const toggle = screen.getByRole('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('Checking the schema first');
    expect(screen.queryByTestId('markdown-viewer')).toBeNull();
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

  it('hides thinking blocks when showReasoningBlocks is off (the default)', async () => {
    storeState.current = { userPreferences: { showReasoningBlocks: false } };
    await renderStreaming(
      [
        thinking('msg_1:0', 'Hidden reasoning'),
        { type: 'text', id: 'msg_1:1', text: 'Visible answer' },
      ],
      false,
    );

    expect(document.querySelector('.content-block--thinking')).toBeNull();
    expect(document.querySelector('.content-block--text')?.textContent).toContain(
      'Visible answer',
    );
  });

  it('hides thinking blocks on a fresh (empty) preferences state', async () => {
    storeState.current = {};
    await renderStreaming([thinking('msg_1:0', 'Hidden reasoning')], true);

    expect(document.querySelector('.content-block--thinking')).toBeNull();
  });

  it('hides legacy <think>-tag reasoning when showReasoningBlocks is off', async () => {
    // groupContentBlocks converts <think>…</think> text into thinking blocks,
    // so the preference filter must run AFTER grouping to catch them.
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

    expect(document.querySelector('.content-block--thinking')).toBeNull();
    expect(document.body.textContent).not.toContain('legacy hidden reasoning');
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
    expect(document.body.textContent).toContain('legacy visible reasoning');
  });
});
