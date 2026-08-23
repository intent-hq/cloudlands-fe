/**
 * @vitest-environment jsdom
 *
 * Manual collapse removes the complete detail subtree for every group position.
 * A collapsed streaming group stays collapsed while new chunks arrive until the
 * user expands it again.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import ResponseGroup from '../ResponseGroup.svelte';
import {
  dedupeKeys,
  getResponseGroupBlockKey,
  getResponseGroupBlockKeys,
  getResponseGroupCurrentBlock,
  getResponseGroupCurrentBlockIndex,
  getResponseGroupPreviewBlock,
  isReasoningPhaseGroupName,
  normalizeResponseGroup,
} from '../response-group-blocks';
import { warmImport } from '../../../../test/warm-import';
import type { ContentBlock } from '$shared/types';
import ResponseGroupCollapseHost from './ResponseGroupCollapseHost.svelte';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('$lib/components/markdown/MarkdownViewer.svelte', async () => ({
  default: (await import('./mocks/MarkdownViewerStub.svelte')).default,
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ theme: { name: 'light' } }),
    dispatch: vi.fn(),
  });
});

// Pre-warm the component module graphs so the cold dynamic imports are not
// billed to the first test's timeout (intent-hq/monorepo#1464, #3032).
warmImport(() => import('../../ui/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../MessageContent.svelte'));
warmImport(() => import('../StreamingMessageContent.svelte'));

describe('ResponseGroup - collapse state model', () => {
  const children = createRawSnippet(() => ({
    render: () => '<div class="test-block">block</div>',
  }));

  function header(container: HTMLElement): HTMLButtonElement {
    return container.querySelector('button')!;
  }

  function details(container: HTMLElement): HTMLElement | null {
    return container.querySelector('[data-operational-expanded-content]');
  }

  it('gives duplicate-name instances stable unique details IDs and isolated controls', async () => {
    const first = render(ResponseGroup, { props: { name: 'Repeated group', children } });
    const second = render(ResponseGroup, { props: { name: 'Repeated group', children } });
    const firstButton = header(first.container);
    const secondButton = header(second.container);
    const firstId = firstButton.getAttribute('aria-controls')!;
    const secondId = secondButton.getAttribute('aria-controls')!;

    expect(firstId).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
    expect(secondId).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
    expect(firstId).not.toBe(secondId);

    await first.rerender({ name: 'Renamed group' });
    expect(firstButton.getAttribute('aria-controls')).toBe(firstId);

    await fireEvent.click(firstButton);
    expect(first.container.contains(document.getElementById(firstId))).toBe(true);
    expect(document.getElementById(secondId)).toBeNull();

    await fireEvent.click(secondButton);
    expect(second.container.contains(document.getElementById(secondId))).toBe(true);
    expect(second.container.contains(document.getElementById(firstId))).toBe(false);

    await fireEvent.click(firstButton);
    await waitFor(() => expect(document.getElementById(firstId)).toBeNull());
    expect(document.getElementById(secondId)).not.toBeNull();
    expect(secondButton.getAttribute('aria-expanded')).toBe('true');
  });

  it('uses caption-sized operational titles and only shows the preview while collapsed', async () => {
    const blocks = [{ type: 'text', text: 'Collapsed preview text' }] as ContentBlock[];
    const { container, queryByText } = render(ResponseGroup, {
      props: { name: 'Group title', blocks, children },
    });
    const btn = header(container);
    const row = container.querySelector('[data-testid="response-group"]')!;

    expect(row.className).toContain('type-body');
    expect(row.className).toContain('text-muted-foreground');
    expect(row.className).not.toContain('text-base');
    expect(btn.className).not.toContain('px-1');
    await waitFor(() => expect(queryByText('Collapsed preview text')).not.toBeNull());

    await fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(queryByText('Collapsed preview text')).toBeNull();
    const name = container.querySelector('[data-testid="response-group-name"]')!;
    expect(name.className).toContain('font-normal');
    expect(name.className).not.toContain('font-medium');
    expect(container.querySelector('[data-operational-expanded-content]')).toBeTruthy();
  });

  it('renders the collapsed text preview as inert inline Markdown', async () => {
    const blocks = [
      { type: 'text', text: '**Reviewed** _layout_ with [`details`](https://example.com)' },
    ] as ContentBlock[];
    const { container } = render(ResponseGroup, {
      props: { name: 'Group title', blocks, children },
    });

    const snippet = container.querySelector('[data-testid="response-group-snippet"]')!;
    await waitFor(() => expect(snippet.querySelector('strong')?.textContent).toBe('Reviewed'));
    expect(snippet.querySelector('em')?.textContent).toBe('layout');
    expect(snippet.querySelector('code')?.textContent).toBe('details');
    expect(snippet.querySelector('a, button, [tabindex]')).toBeNull();
    expect(header(container).querySelectorAll('button')).toHaveLength(0);
  });

  it('moves the disclosure state into the leading icon and omits the trailing chevron', async () => {
    const { container } = render(ResponseGroup, {
      props: { name: 'Group title', children },
    });

    const button = header(container);
    expect(button.querySelector('[data-operational-icon-box]')).toBeTruthy();
    expect(button.querySelector('[data-icon="arrows-in-line-vertical"]')).toBeTruthy();
    expect(container.querySelector('[data-operational-chevron]')).toBeNull();
    await fireEvent.click(button);
    expect(button.querySelector('[data-icon="arrows-out-line-vertical"]')).toBeTruthy();
    expect(button.querySelector('[data-icon="arrows-in-line-vertical"]')).toBeNull();
    expect(container.querySelector('[data-operational-expanded-content]')?.className).not.toMatch(
      /\bpt-/,
    );
  });

  it('keeps expanded prose unconstrained with canonical top spacing', () => {
    const blocks = [{ type: 'text', text: 'Expanded prose' }] as ContentBlock[];
    const { container } = render(ResponseGroup, {
      props: { name: 'Constrained group', isStreaming: true, blocks, children },
    });
    const expanded = container.querySelector('[data-operational-expanded-content]')!;
    const scroller = container.querySelector('.cylinder-scroller') as HTMLElement;

    expect(expanded.className).toContain('pt-4');
    expect(scroller.style.maxHeight).toBe('');
    expect(scroller.className).toContain('cylinder-scroller');
  });

  for (const position of ['first', 'middle', 'last'] as const) {
    it(`fully removes the ${position} streaming group body after manual collapse`, async () => {
      const blocks = [{ type: 'text', text: `${position} activity` }] as ContentBlock[];
      const { container } = render(ResponseGroup, {
        props: {
          name: `${position} group`,
          isStreaming: true,
          blocks,
          children,
        },
      });
      const btn = header(container);

      expect(btn.getAttribute('aria-expanded')).toBe('true');
      expect(details(container)).not.toBeNull();
      expect(container.querySelector('.cylinder-scroller')).not.toBeNull();

      await fireEvent.click(btn);
      await waitFor(() => expect(btn.getAttribute('aria-expanded')).toBe('false'));
      expect(details(container)).toBeNull();
      expect(container.querySelector('.cylinder-scroller')).toBeNull();
      expect(container.querySelector('.test-block')).toBeNull();
      await waitFor(() =>
        expect(
          container.querySelector('[data-testid="response-group-snippet"]')?.textContent,
        ).toContain(`${position} activity`),
      );
    });
  }

  it('keeps a manual streaming collapse while new chunks arrive until manual expand', async () => {
    const detailFactory = vi.fn(() => ({
      render: () => '<button data-testid="detail-focus">exact expanded payload</button>',
    }));
    const initialBlocks = [{ type: 'text', text: 'first payload' }] as ContentBlock[];
    const { container, rerender } = render(ResponseGroup, {
      props: {
        name: 'Streaming group',
        isStreaming: true,
        blocks: initialBlocks,
        children: createRawSnippet(detailFactory),
      },
    });
    const btn = header(container);
    expect(detailFactory).toHaveBeenCalledTimes(1);

    await fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute('aria-expanded')).toBe('false'));
    expect(details(container)).toBeNull();

    await rerender({
      blocks: [...initialBlocks, { type: 'text', text: 'latest {exact} payload' }],
    });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(details(container)).toBeNull();
    expect(detailFactory).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(container.querySelector('[data-testid="response-group-snippet"]')?.textContent).toBe(
        'first payload',
      ),
    );

    await fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute('aria-expanded')).toBe('true'));
    expect(details(container)).not.toBeNull();
    expect(detailFactory).toHaveBeenCalledTimes(2);
  });

  it('moves focus to the disclosure before removing focused descendants', async () => {
    const focusChildren = createRawSnippet(() => ({
      render: () => '<button data-testid="focused-detail">Focusable detail</button>',
    }));
    const { container } = render(ResponseGroup, {
      props: { name: 'Focusable group', isStreaming: true, children: focusChildren },
    });
    const btn = header(container);
    const detailButton = container.querySelector(
      '[data-testid="focused-detail"]',
    ) as HTMLButtonElement;
    detailButton.focus();
    expect(document.activeElement).toBe(detailButton);

    await fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute('aria-expanded')).toBe('false'));
    expect(document.activeElement).toBe(btn);
    expect(details(container)).toBeNull();
    expect(container.querySelector('[data-testid="focused-detail"]')).toBeNull();
  });

  it('supports repeated full expand and collapse cycles', async () => {
    const { container } = render(ResponseGroup, { props: { name: 'Group', children } });
    const btn = header(container);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await fireEvent.click(btn);
      await waitFor(() => expect(btn.getAttribute('aria-expanded')).toBe('true'));
      expect(details(container)?.getAttribute('data-response-group-motion')).toBe(
        'height-opacity-y',
      );
      await fireEvent.click(btn);
      await waitFor(() => expect(btn.getAttribute('aria-expanded')).toBe('false'));
      expect(details(container)).toBeNull();
    }
  });

  it('auto-collapses exactly 800 ms after its own stream completes', async () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(ResponseGroup, {
        props: { name: 'Current group', isStreaming: true, children },
      });
      const btn = header(container);

      await rerender({ isStreaming: false });
      await vi.advanceTimersByTimeAsync(799);
      expect(btn.getAttribute('aria-expanded')).toBe('true');

      await vi.advanceTimersByTimeAsync(1);
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      expect(details(container)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears a pending automatic collapse when destroyed', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      const { rerender, unmount } = render(ResponseGroup, {
        props: { name: 'Removed group', isStreaming: true, children },
      });

      await rerender({ isStreaming: false });
      const collapseTimerIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 800);
      expect(collapseTimerIndex).toBeGreaterThanOrEqual(0);
      const collapseTimer = setTimeoutSpy.mock.results[collapseTimerIndex].value;

      unmount();
      expect(clearTimeoutSpy).toHaveBeenCalledWith(collapseTimer);
      await vi.advanceTimersByTimeAsync(800);
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('drives sequential groups independently while later response activity continues', async () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(ResponseGroupCollapseHost, {
        props: { activePosition: 'first' },
      });
      const expandedStates = () =>
        [...container.querySelectorAll('[data-testid="response-group-disclosure"]')].map((node) =>
          node.getAttribute('aria-expanded'),
        );

      expect(expandedStates()).toEqual(['true', 'false', 'false']);

      await rerender({ activePosition: 'middle' });
      await vi.advanceTimersByTimeAsync(800);
      expect(expandedStates()).toEqual(['false', 'true', 'false']);

      await rerender({ activePosition: 'last' });
      await vi.advanceTimersByTimeAsync(800);
      expect(expandedStates()).toEqual(['false', 'false', 'true']);

      await rerender({ activePosition: 'thinking' });
      expect(
        container.querySelector('[data-testid="response-after-groups"]')?.textContent,
      ).toContain('Later Thinking/response activity continues');
      await vi.advanceTimersByTimeAsync(799);
      expect(expandedStates()).toEqual(['false', 'false', 'true']);
      await vi.advanceTimersByTimeAsync(1);
      expect(expandedStates()).toEqual(['false', 'false', 'false']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a completed group manually reopenable after automatic collapse', async () => {
    vi.useFakeTimers();
    try {
      const blocks = [{ type: 'text', text: 'Visible summary' }] as ContentBlock[];
      const { container, rerender } = render(ResponseGroup, {
        props: { name: 'Final group', isStreaming: true, blocks, children },
      });
      const btn = header(container);

      await rerender({ isStreaming: false });
      await vi.advanceTimersByTimeAsync(800);
      expect(btn.getAttribute('aria-expanded')).toBe('false');

      await fireEvent.click(btn);
      expect(btn.getAttribute('aria-expanded')).toBe('true');
      expect(details(container)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores only search-owned expansion and preserves explicit user disclosure', async () => {
    const { container } = render(ResponseGroup, {
      props: { name: 'Searchable group', searchPath: 'b:0', children },
    });
    const btn = header(container);
    const group = container.querySelector('[data-chat-search-disclosure-id="group:b:0"]')!;

    group.dispatchEvent(new CustomEvent('chatsearchexpand'));
    await waitFor(() => expect(btn.getAttribute('aria-expanded')).toBe('true'));
    group.dispatchEvent(new CustomEvent('chatsearchrestore'));
    await waitFor(() => expect(btn.getAttribute('aria-expanded')).toBe('false'));

    await fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    group.dispatchEvent(new CustomEvent('chatsearchexpand'));
    group.dispatchEvent(new CustomEvent('chatsearchrestore'));
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('ResponseGroup - block identity', () => {
  it('recognizes only the alternate-model reasoning phase name', () => {
    expect(isReasoningPhaseGroupName('Prepping')).toBe(true);
    expect(isReasoningPhaseGroupName(' prepping ')).toBe(true);
    expect(isReasoningPhaseGroupName('Working')).toBe(false);
    expect(isReasoningPhaseGroupName('Plan')).toBe(false);
  });

  it('pairs the first alternate reasoning name with the group description once', () => {
    const description = {
      type: 'text',
      text: 'Read the spec and inspect the screenshot.',
    } as ContentBlock;
    const firstReasoning = {
      type: 'thinking',
      text: 'Reasoning\n\n**Invoking workspace API to set title**',
    } as ContentBlock;
    const laterReasoning = {
      type: 'thinking',
      text: 'Planning clarification questions\n\nPlanning code inspection.',
    } as ContentBlock;
    const namedGroup = {
      type: 'content_group' as const,
      name: 'Prepping',
      isStreaming: true,
      children: [description, firstReasoning, laterReasoning],
    };

    expect(normalizeResponseGroup(namedGroup)).toEqual({
      ...namedGroup,
      name: 'Reasoning',
      sourceName: 'Prepping',
      isReasoningPhase: true,
      children: [
        description,
        { type: 'text', text: '**Invoking workspace API to set title**' },
        {
          type: 'text',
          text: 'Planning clarification questions\n\nPlanning code inspection.',
        },
      ],
    });

    const normalGroup = { ...namedGroup, name: 'Working' };
    expect(normalizeResponseGroup(normalGroup)).toBe(normalGroup);
  });

  it('selects the last visible child and skips trailing tool results', () => {
    const blocks = [
      { type: 'thinking', id: 'thought-1', text: 'Earlier reasoning' },
      { type: 'tool_use', id: 'tool-1', name: 'view', input: {} },
      { type: 'tool_result', tool_use_id: 'tool-1', output: 'done' },
    ] as ContentBlock[];

    expect(getResponseGroupCurrentBlockIndex(blocks)).toBe(1);
    expect(getResponseGroupCurrentBlock(blocks)).toBe(blocks[1]);
    expect(getResponseGroupCurrentBlock([{ type: 'tool_result' } as ContentBlock])).toBeUndefined();
  });

  it('uses protocol-backed tool identities instead of positions', () => {
    const toolUse = { type: 'tool_use', id: 'tool-42', name: 'search' } as ContentBlock;
    const toolResult = { type: 'tool_result', tool_use_id: 'tool-42' } as ContentBlock;

    expect(getResponseGroupBlockKey(toolUse, 1)).toBe(getResponseGroupBlockKey(toolUse, 99));
    expect(getResponseGroupBlockKey(toolResult, 2)).toBe(getResponseGroupBlockKey(toolResult, 100));
  });

  it('getResponseGroupBlockKeys dedupes tool_results sharing a tool_use_id', () => {
    const blocks = [
      { type: 'tool_result', tool_use_id: 'tool-1' },
      { type: 'tool_result', tool_use_id: 'tool-1' },
    ] as ContentBlock[];

    const keys = getResponseGroupBlockKeys(blocks);
    expect(new Set(keys).size).toBe(blocks.length);
    expect(keys[0]).toBe('tool_result:tool-1');
    expect(keys[1]).toBe('tool_result:tool-1-dup-1');
  });

  it('getResponseGroupBlockKeys dedupes tool_uses sharing a toolCallId without an id', () => {
    const blocks = [
      { type: 'tool_use', toolCallId: 'call-7', name: 'search' },
      { type: 'tool_use', toolCallId: 'call-7', name: 'search' },
      { type: 'tool_use', toolCallId: 'call-7', name: 'search' },
    ] as unknown as ContentBlock[];

    const keys = getResponseGroupBlockKeys(blocks);
    expect(new Set(keys).size).toBe(blocks.length);
    expect(keys[0]).toBe('tool_use:call-7');
    expect(keys[1]).toBe('tool_use:call-7-dup-1');
    expect(keys[2]).toBe('tool_use:call-7-dup-2');
  });

  it('getResponseGroupBlockKeys dedupes repeated id-backed blocks', () => {
    const blocks = [
      { type: 'code', id: 'block-1', code: 'a' },
      { type: 'code', id: 'block-1', code: 'a' },
    ] as unknown as ContentBlock[];

    const keys = getResponseGroupBlockKeys(blocks);
    expect(new Set(keys).size).toBe(blocks.length);
    expect(keys[1]).toBe(`${keys[0]}-dup-1`);
  });

  it('getResponseGroupBlockKeys leaves collision-free inputs unchanged', () => {
    const blocks = [
      { type: 'tool_use', id: 'tool-1', name: 'search' },
      { type: 'tool_result', tool_use_id: 'tool-1' },
      { type: 'text', text: 'hello' },
      { type: 'thinking', text: 'hmm' },
    ] as ContentBlock[];

    const keys = getResponseGroupBlockKeys(blocks);
    expect(keys).toEqual(blocks.map((block, index) => getResponseGroupBlockKey(block, index)));
    expect(new Set(keys).size).toBe(blocks.length);
  });

  it('selects the first visible expanded payload without cloning or rewriting it', () => {
    const openingText = {
      type: 'text',
      text: 'First visible expanded content',
    } as ContentBlock;
    const laterTool = {
      type: 'tool_use',
      id: 'tool-latest',
      name: 'workspace_api',
      input: { summary: 'Later payload' },
    } as ContentBlock;
    const trailingResult = {
      type: 'tool_result',
      tool_use_id: 'tool-latest',
      output: { content: 'exact result' },
    } as ContentBlock;

    expect(getResponseGroupPreviewBlock([openingText, laterTool, trailingResult])).toBe(
      openingText,
    );
  });
});

describe('dedupeKeys', () => {
  it('resolves second-order collisions against already-emitted keys', () => {
    // A raw input key can collide with a suffix emitted for an earlier
    // duplicate: ['K', 'K', 'K-dup-1'] must not emit 'K-dup-1' twice.
    const keys = dedupeKeys(['K', 'K', 'K-dup-1']);
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toBe('K');
    expect(keys[1]).toBe('K-dup-1');
    expect(keys[2]).not.toBe('K-dup-1');
  });

  it('suffixes by occurrence count, stable under prefix insertions', () => {
    expect(dedupeKeys(['K', 'K', 'K'])).toEqual(['K', 'K-dup-1', 'K-dup-2']);
    // Inserting an unrelated key before the duplicates must not shift their suffixes.
    expect(dedupeKeys(['A', 'K', 'K']).slice(1)).toEqual(dedupeKeys(['K', 'K']));
  });

  it('leaves collision-free inputs byte-identical', () => {
    const keys = ['a', 'b', 'c-dup-1', 'd'];
    expect(dedupeKeys(keys)).toEqual(keys);
  });

  it('propagates through getResponseGroupBlockKeys for id-shaped collisions', () => {
    const blocks = [
      { type: 'tool_result', tool_use_id: 'call' },
      { type: 'tool_result', tool_use_id: 'call' },
      { type: 'tool_result', tool_use_id: 'call-dup-1' },
    ] as ContentBlock[];

    const keys = getResponseGroupBlockKeys(blocks);
    expect(new Set(keys).size).toBe(blocks.length);
  });
});

describe('MessageContent - top-level response rows', () => {
  it('renders duplicate top-level tool_results without each_key_duplicate', async () => {
    const MessageContent = (await import('../MessageContent.svelte')).default;
    const content = [
      { type: 'tool_result', tool_use_id: 'call-1', output: 'first' },
      { type: 'tool_result', tool_use_id: 'call-1', output: 'second' },
    ] as ContentBlock[];

    const { container } = render(MessageContent, { props: { content } });
    expect(container.querySelectorAll('.border.border-border').length).toBe(2);
  });

  it('keeps adjacent operational seams and aligns nested prose with the group header text', async () => {
    const MessageContent = (await import('../MessageContent.svelte')).default;
    const StreamingMessageContent = (await import('../StreamingMessageContent.svelte')).default;
    const content: ContentBlock[] = [
      { type: 'text', text: '<group:Plan>' },
      { type: 'text', text: 'Grouped detail' },
      { type: 'thinking', text: 'Nested reasoning' },
      { type: 'tool_use', id: 'nested-tool', name: 'view', input: { path: 'src/example.ts' } },
      { type: 'text', text: '</group:Plan>\nFollowing prose' },
    ];

    const { container } = render(MessageContent, { props: { content } });
    const button = container.querySelector('button')!;
    const group = button.closest('[data-testid="response-group"]');
    expect(container.firstElementChild?.className).toContain('gap-0');
    expect(group?.className).not.toContain('mb-1.5');
    await fireEvent.click(button);
    await waitFor(() => expect(group?.querySelector('[data-response-group-content]')).toBeTruthy());
    expect(group?.querySelector('[data-response-group-content]')?.className).toContain('gap-0');
    const groupContent = group?.querySelector('[data-response-group-content]');
    expect(groupContent?.querySelector('[data-operational-expanded-guide]')).toBeTruthy();
    const proseChild = groupContent?.querySelector('[data-message-content-block="text"]');
    const operationalChild = groupContent?.querySelector('[data-message-content-block="thinking"]');
    const toolChild = groupContent?.querySelector('[data-message-content-block="tool_use"]');
    expect(proseChild?.className).toContain(
      'pl-[calc(var(--operational-row-inline-padding)+var(--operational-leading-slot-size)+var(--operational-leading-gap))]',
    );
    expect(proseChild?.getAttribute('style')).toContain(
      'padding-left: calc(var(--operational-row-inline-padding) + var(--operational-leading-slot-size) + var(--operational-leading-gap))',
    );
    expect(operationalChild?.className).toContain('operational-group-child-row');
    expect(operationalChild?.className).toContain('ml-2');
    expect(operationalChild?.getAttribute('style')).toBeNull();
    expect(toolChild?.className).toContain('operational-group-child-row');
    expect(toolChild?.className).toContain('ml-2');
    expect(toolChild?.className).toContain('w-[calc(100%-0.5rem)]');

    const streaming = render(StreamingMessageContent, {
      props: { content, isStreaming: true },
    });
    await fireEvent.click(
      streaming.container.querySelector('[data-testid="response-group-disclosure"]')!,
    );
    const streamingChild = await waitFor(() => {
      const child = streaming.container.querySelector('[data-message-content-block="thinking"]');
      expect(child).toBeTruthy();
      return child;
    });
    expect(streamingChild?.className).toContain('operational-group-child-row');
    expect(streamingChild?.className).toContain('ml-2');
    expect(streamingChild?.getAttribute('style')).toBeNull();
    expect(
      streaming.container.querySelector('[data-message-content-block="tool_use"]')?.className,
    ).toContain('ml-2');
  });
});
