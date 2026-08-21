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
warmImport(() => import('../MessageContent.svelte'));

/** Daemon-shaped thinking block (PROTOCOL §7.1). */
function thinking(id: string, text: string): ContentBlock {
  return { type: 'thinking', id, text };
}

async function renderStreaming(content: ContentBlock[], isStreaming: boolean) {
  const StreamingMessageContent = (await import('../StreamingMessageContent.svelte')).default;
  return render(StreamingMessageContent, { props: { content, isStreaming } });
}

async function renderStatic(content: ContentBlock[]) {
  const MessageContent = (await import('../MessageContent.svelte')).default;
  return render(MessageContent, { props: { content } });
}

describe('thinking blocks — StreamingMessageContent', () => {
  it('renders the daemon `text` field while streaming (auto-expanded)', async () => {
    await renderStreaming([thinking('msg_1:0', 'Checking the schema first')], true);

    const viewer = screen.getByTestId('markdown-viewer');
    expect(viewer.textContent).toContain('Checking the schema first');
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });

  it('renders a restored headingless block with the localized collapsed fallback', async () => {
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
    await renderStreaming(
      [{ type: 'thinking', content: 'Legacy restoration plan\n\nInspect saved state.' }],
      true,
    );

    expect(screen.getByRole('button').textContent?.trim()).toBe('Legacy restoration plan');
    expect(screen.getByTestId('markdown-viewer').textContent).toBe('Inspect saved state.');
  });

  it('uses the reasoning title for daemon streaming and restored-history paths', async () => {
    const content = [thinking('msg_1:0', 'Considering task restoration\n\nInspect saved state.')];
    const view = await renderStreaming(content, true);
    expect(screen.getByRole('button').textContent?.trim()).toBe('Considering task restoration');
    expect(screen.getByTestId('markdown-viewer').textContent).toBe('Inspect saved state.');

    await view.rerender({ content, isStreaming: false });
    expect(screen.getByRole('button').textContent?.trim()).toBe('Considering task restoration');
    expect(screen.queryByTestId('markdown-viewer')).toBeNull();
  });

  it('only streams the last visible thinking child in a live response group', async () => {
    const content = [
      { type: 'text', id: 'msg_1:0', text: '<group:Working>' },
      thinking('msg_1:1', 'First headingless thought'),
      thinking('msg_1:2', 'Second headingless thought'),
    ];
    const view = await renderStreaming(content, true);
    let disclosures = screen.getAllByTestId('reasoning-disclosure');

    expect(disclosures.map((button) => button.getAttribute('aria-expanded'))).toEqual([
      'false',
      'true',
    ]);
    expect(disclosures.map((button) => button.textContent?.trim())).toEqual([
      'Reasoning',
      'Thinking...',
    ]);

    await view.rerender({
      content: [...content, { type: 'text', id: 'msg_1:3', text: 'Visible answer' }],
      isStreaming: true,
    });
    disclosures = screen.getAllByTestId('reasoning-disclosure');

    expect(disclosures.map((button) => button.getAttribute('aria-expanded'))).toEqual([
      'false',
      'false',
    ]);
    expect(disclosures.map((button) => button.textContent?.trim())).toEqual([
      'Reasoning',
      'Reasoning',
    ]);
  });

  it('uses the reasoning title in the static message path', async () => {
    await renderStatic([
      thinking('msg_1:0', '# Considering task restoration\n\nInspect saved state.'),
    ]);

    const toggle = screen.getByRole('button');
    expect(toggle.textContent?.trim()).toBe('Considering task restoration');
    await fireEvent.click(toggle);
    expect(screen.getByTestId('markdown-viewer').textContent).toBe('Inspect saved state.');
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

  it('only flags the truly last block of a streaming message as streaming inside a group', async () => {
    // Streaming message whose last top-level block is an unclosed <group:…>
    // containing [thinking, tool_use, thinking, text]. Only the final text
    // block is still streaming; the completed thinking blocks must render
    // static (collapsed, no pulse animation).
    await renderStreaming(
      [
        { type: 'text', id: 'msg_1:0', text: '<group:Working>' },
        thinking('msg_1:1', 'First reasoning pass'),
        { type: 'tool_use', id: 'msg_1:2', name: 'view', input: {} } as ContentBlock,
        thinking('msg_1:3', 'Second reasoning pass'),
        { type: 'text', id: 'msg_1:4', text: 'Partial streamed answer' },
      ],
      true,
    );

    const thinkingRows = document.querySelectorAll('.content-block--thinking');
    expect(thinkingRows).toHaveLength(2);
    for (const row of thinkingRows) {
      expect(row.querySelector('[data-operational-leading]')?.className).not.toContain(
        'animate-pulse',
      );
      expect(row.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false');
    }

    const streamingViewers = [...document.querySelectorAll('[data-testid="markdown-viewer"]')]
      .filter((viewer) => viewer.getAttribute('data-streaming') === 'true');
    expect(streamingViewers.map((viewer) => viewer.textContent)).toEqual([
      'Partial streamed answer',
    ]);
  });

  it('flags a trailing streaming thinking block inside a group as streaming', async () => {
    await renderStreaming(
      [
        { type: 'text', id: 'msg_1:0', text: '<group:Working>' },
        thinking('msg_1:1', 'First reasoning pass'),
        thinking('msg_1:2', 'Still reasoning'),
      ],
      true,
    );

    const thinkingRows = document.querySelectorAll('.content-block--thinking');
    expect(thinkingRows).toHaveLength(2);
    expect(
      thinkingRows[0].querySelector('[data-operational-leading]')?.className,
    ).not.toContain('animate-pulse');
    expect(thinkingRows[1].querySelector('[data-operational-leading]')?.className).toContain(
      'animate-pulse',
    );
  });

  it('only flags the last parsed entry of the last text block as streaming', async () => {
    // A single trailing text ContentBlock can expand into multiple
    // ParsedContent entries (text around an embedded special block). Only the
    // final parsed entry is still streaming.
    await renderStreaming(
      [
        {
          type: 'text',
          id: 'msg_1:0',
          text: 'Before block\n\n<COMMIT_MESSAGE>feat: something</COMMIT_MESSAGE>\n\nAfter streaming',
        },
      ],
      true,
    );

    const viewers = [...document.querySelectorAll('[data-testid="markdown-viewer"]')];
    expect(viewers.map((viewer) => viewer.textContent)).toEqual([
      'Before block',
      'After streaming',
    ]);
    expect(viewers.map((viewer) => viewer.getAttribute('data-streaming'))).toEqual([
      'false',
      'true',
    ]);
  });

  it('flags the last visible group child as streaming when a hidden child trails', async () => {
    // tool_result children are never rendered by the group loop — a trailing
    // one must not steal the "last block" streaming flag from the final
    // visible thinking block.
    await renderStreaming(
      [
        { type: 'text', id: 'msg_1:0', text: '<group:Working>' },
        thinking('msg_1:1', 'Reasoning while a result trails'),
        { type: 'tool_result', tool_use_id: 'call_1', output: 'done' } as ContentBlock,
      ],
      true,
    );

    const thinkingRows = document.querySelectorAll('.content-block--thinking');
    expect(thinkingRows).toHaveLength(1);
    expect(thinkingRows[0].querySelector('[data-operational-leading]')?.className).toContain(
      'animate-pulse',
    );
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
