/**
 * @vitest-environment jsdom
 *
 * Daemon-emitted reasoning renders live and persisted. The §7.1 `thinking`
 * block the daemon streams carries its reasoning in `text`
 * (`{ type: 'thinking', id: 'msg_1:0', text: '…' }`, intentd#973) — the render
 * sites must read it, not only the legacy `content` field the FE's own
 * <think>-tag parser produces.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage, ContentBlock } from '$shared/types';
import { warmImport } from '../../../../test/warm-import';
import { findChatSearchMatches } from '../chat-search';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('$lib/components/markdown/MarkdownViewer.svelte', async () => ({
  default: (await import('./mocks/MarkdownViewerStub.svelte')).default,
}));

const storeState = vi.hoisted(() => ({
  current: { theme: { name: 'light' } } as Record<string, unknown>,
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => storeState.current, dispatch: vi.fn() });
});

afterEach(() => {
  storeState.current = { theme: { name: 'light' } };
  cleanup();
});

warmImport(() => import('../StreamingMessageContent.svelte'), 300_000);
warmImport(() => import('../MessageContent.svelte'), 300_000);
warmImport(() => import('../ReasoningHistoryBlock.svelte'), 300_000);

/** Daemon-shaped thinking block (PROTOCOL §7.1). */
function thinking(id: string, text: string): ContentBlock {
  return { type: 'thinking', id, text };
}

async function renderStreaming(content: ContentBlock[], isStreaming: boolean) {
  const StreamingMessageContent = (await import('../StreamingMessageContent.svelte')).default;
  return render(StreamingMessageContent, { props: { content, isStreaming } });
}

async function renderMessage(content: ContentBlock[], isStreaming: boolean) {
  const MessageContent = (await import('../MessageContent.svelte')).default;
  return render(MessageContent, { props: { content, isStreaming } });
}

async function renderStatic(content: ContentBlock[]) {
  return renderMessage(content, false);
}

async function renderReasoningHistory(content: string) {
  const ReasoningHistoryBlock = (await import('../ReasoningHistoryBlock.svelte')).default;
  return render(ReasoningHistoryBlock, { props: { content, searchPath: 'b:0:c:1' } });
}

describe('reasoning history search targets', () => {
  it('marks a title-only phase with its stable summary target', async () => {
    const { container } = await renderReasoningHistory('Title-only search target');

    expect(
      container.querySelector('[data-chat-search-block-path="b:0:c:1:p:0:summary"]')?.textContent,
    ).toContain('Title-only search target');
    expect(container.querySelector('[data-chat-search-block-path$=":body"]')).toBeNull();
  });

  it('marks a body-only phase with its stable body target after search expansion', async () => {
    const { container } = await renderReasoningHistory(
      'This body-only search target is a complete explanatory sentence.',
    );
    const disclosure = container.querySelector('[data-chat-search-disclosure-id]')!;

    disclosure.dispatchEvent(new CustomEvent('chatsearchexpand'));
    await waitFor(() =>
      expect(
        container.querySelector('[data-chat-search-block-path="b:0:c:1:p:0:body"]'),
      ).not.toBeNull(),
    );
    expect(
      container.querySelector('[data-chat-search-block-path="b:0:c:1:p:0:body"]')?.textContent,
    ).toContain('body-only search target');
  });

  it('keeps shared title and body text independently targetable and restores search ownership', async () => {
    const { container } = await renderReasoningHistory(
      'Shared-marker title\n\nShared-marker body explanation.',
    );
    const disclosure = container.querySelector('[data-chat-search-disclosure-id]')!;
    const button = screen.getByRole('button');
    const summary = container.querySelector('[data-chat-search-block-path="b:0:c:1:p:0:summary"]')!;

    disclosure.dispatchEvent(new CustomEvent('chatsearchexpand'));
    await waitFor(() =>
      expect(
        container.querySelector('[data-chat-search-block-path="b:0:c:1:p:0:body"]'),
      ).not.toBeNull(),
    );
    const body = container.querySelector('[data-chat-search-block-path="b:0:c:1:p:0:body"]')!;
    expect(summary.compareDocumentPosition(body!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.getAttribute('aria-expanded')).toBe('true');

    disclosure.dispatchEvent(new CustomEvent('chatsearchrestore'));
    await waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('false'));
    expect(container.querySelector('[data-chat-search-block-path$=":body"]')).toBeNull();

    await fireEvent.click(button);
    disclosure.dispatchEvent(new CustomEvent('chatsearchexpand'));
    disclosure.dispatchEvent(new CustomEvent('chatsearchrestore'));
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('thinking blocks — StreamingMessageContent', () => {
  it('renders the daemon `text` field while streaming (auto-expanded)', async () => {
    await renderStreaming([thinking('msg_1:0', 'Checking the schema first')], true);

    const viewer = screen.getByTestId('markdown-viewer');
    expect(viewer.textContent).toContain('Checking the schema first');
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });

  it('renders a restored headingless block as a collapsed reasoning disclosure', async () => {
    await renderStreaming([thinking('msg_1:0', 'Checking the schema first')], false);

    const toggle = screen.getByRole('button', { name: 'Reasoning' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.textContent).not.toContain('Checking the schema first');

    await fireEvent.click(toggle);
    expect(screen.getByTestId('markdown-viewer').textContent).toContain(
      'Checking the schema first',
    );
  });

  const persistedStandaloneMessage = {
    id: 'assistant-dark-mode-sanitized',
    role: 'assistant',
    isStreaming: false,
    contentBlocks: [
      thinking(
        'dark-mode-standalone:0',
        'I am checking the saved theme preference before changing the interface.',
      ),
      {
        type: 'tool_use',
        id: 'dark-mode-standalone:1',
        toolCallId: 'theme-source-call',
        name: 'view',
        input: { path: 'src/theme.ts' },
      },
      {
        type: 'tool_result',
        id: 'dark-mode-standalone:2',
        tool_use_id: 'theme-source-call',
        output: 'Sanitized theme source',
      },
      thinking(
        'dark-mode-standalone:3',
        'The saved preference and system fallback use separate paths.',
      ),
      { type: 'text', id: 'dark-mode-standalone:4', text: 'Theme storage is understood.' },
    ] as ContentBlock[],
  } as AgentMessage;

  it.each([
    ['MessageContent', renderStatic],
    ['StreamingMessageContent', (content: ContentBlock[]) => renderStreaming(content, false)],
  ])(
    'renders persisted standalone headingless reasoning as collapsed disclosures in %s',
    async (_, renderPersistedMessage) => {
      await renderPersistedMessage(persistedStandaloneMessage.contentBlocks ?? []);

      const disclosures = screen.getAllByRole('button', { name: 'Reasoning' });
      expect(disclosures).toHaveLength(2);
      expect(disclosures.every((btn) => btn.getAttribute('aria-expanded') === 'false')).toBe(true);
      expect(document.querySelectorAll('[data-message-content-block="thinking"]')).toHaveLength(2);
      expect(document.querySelectorAll('[data-tool-use-id]')).toHaveLength(1);

      expect(document.body.textContent).not.toContain(
        'I am checking the saved theme preference before changing the interface.',
      );
      expect(document.body.textContent).not.toContain(
        'The saved preference and system fallback use separate paths.',
      );
      expect(document.body.textContent?.match(/Theme storage is understood\./g)).toHaveLength(1);

      for (const disclosure of disclosures) {
        await fireEvent.click(disclosure);
      }
      const orderedText = [
        'I am checking the saved theme preference before changing the interface.',
        'The saved preference and system fallback use separate paths.',
        'Theme storage is understood.',
      ].map((text) => screen.getByText(text));
      expect(
        orderedText
          .slice(1)
          .every((node, index) =>
            Boolean(
              orderedText[index].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
            ),
          ),
      ).toBe(true);

      // Standalone thinking uses its disclosure path in the chat search index;
      // final prose stays a separate, directly searchable block.
      expect(
        findChatSearchMatches([persistedStandaloneMessage], 'saved theme preference', new Map()),
      ).toEqual([
        {
          messageId: 'assistant-dark-mode-sanitized',
          matchIndexInMessage: 0,
          occurrenceInBlock: 0,
          turnKey: 'assistant-dark-mode-sanitized',
          blockPath: 'b:0:body',
          disclosurePath: ['reasoning:b:0'],
        },
      ]);
      expect(
        findChatSearchMatches([persistedStandaloneMessage], 'Theme storage', new Map()),
      ).toEqual([
        {
          messageId: 'assistant-dark-mode-sanitized',
          matchIndexInMessage: 0,
          occurrenceInBlock: 0,
          turnKey: 'assistant-dark-mode-sanitized',
          blockPath: 'b:4',
          disclosurePath: [],
        },
      ]);
    },
  );

  it.each([
    ['MessageContent', renderMessage],
    ['StreamingMessageContent', renderStreaming],
  ])(
    'transitions standalone active reasoning to a collapsed disclosure in %s',
    async (_, renderer) => {
      const content = [thinking('standalone-lifecycle:0', 'I am checking the active theme path.')];
      const view = await renderer(content, true);

      expect(
        screen.getByRole('button', { name: 'Thinking...' }).getAttribute('aria-expanded'),
      ).toBe('true');
      expect(screen.getByText('I am checking the active theme path.')).toBeTruthy();

      await view.rerender({ content, isStreaming: false });

      const toggle = screen.getByRole('button', { name: 'Reasoning' });
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(document.body.textContent).not.toContain('I am checking the active theme path.');

      await fireEvent.click(toggle);
      expect(screen.getByText('I am checking the active theme path.')).toBeTruthy();
    },
  );

  it('interleaves thinking and text blocks in stream order', async () => {
    await renderStreaming(
      [
        thinking('msg_1:0', 'First I reason'),
        { type: 'text', id: 'msg_1:1', text: 'Then I answer' },
      ],
      false,
    );

    const rendered = document.querySelectorAll('.content-block--thinking, .content-block--text');
    expect([...rendered].map((el) => el.getAttribute('data-message-content-block'))).toEqual([
      'thinking',
      'text',
    ]);

    await fireEvent.click(screen.getByRole('button', { name: 'Reasoning' }));
    const renderedText = document.body.textContent ?? '';
    expect(renderedText.indexOf('First I reason')).toBeGreaterThanOrEqual(0);
    expect(renderedText.indexOf('First I reason')).toBeLessThan(
      renderedText.indexOf('Then I answer'),
    );
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

  it.each([
    ['MessageContent', renderMessage],
    ['StreamingMessageContent', renderStreaming],
  ])(
    'shows one current live-group child until the user expands full history in %s',
    async (_renderer, renderMessageContent) => {
      const content = [
        { type: 'text', id: 'msg_1:0', text: '<group:Working>' },
        { type: 'text', id: 'msg_1:1', text: 'Earlier answer' },
        thinking('msg_1:2', 'Current thought'),
      ];
      const view = await renderMessageContent(content, true);
      const groupDisclosure = screen.getByTestId('response-group-disclosure');
      const visibleChildTypes = () =>
        [...document.querySelectorAll('[data-response-group-child]')].map((child) =>
          child.getAttribute('data-message-content-block'),
        );

      expect(groupDisclosure.getAttribute('aria-expanded')).toBe('false');
      expect(screen.getByTestId('response-group-name').textContent).toBe('Working');
      expect(visibleChildTypes()).toEqual(['thinking']);
      expect(screen.getAllByTestId('reasoning-disclosure')).toHaveLength(1);

      await view.rerender({
        content: [
          ...content,
          { type: 'tool_result', id: 'msg_1:3', tool_use_id: 'missing', output: 'hidden' },
        ],
        isStreaming: true,
      });
      expect(visibleChildTypes()).toEqual(['thinking']);

      const tool = {
        type: 'tool_use',
        id: 'msg_1:4',
        name: 'view',
        input: { path: 'src/example.ts' },
        toolCallId: 'tool-1',
      } as ContentBlock;
      await view.rerender({ content: [...content, tool], isStreaming: true });
      expect(visibleChildTypes()).toEqual(['tool_use']);

      const withAnswer = [
        ...content,
        tool,
        { type: 'tool_result', id: 'msg_1:5', tool_use_id: 'tool-1', output: 'done' },
        { type: 'text', id: 'msg_1:6', text: 'Current answer' },
      ] as ContentBlock[];
      await view.rerender({ content: withAnswer, isStreaming: true });
      expect(visibleChildTypes()).toEqual(['text']);
      expect(document.body.textContent).toContain('Current answer');
      expect(document.body.textContent).not.toContain('Earlier answer');

      await fireEvent.click(groupDisclosure);
      expect(groupDisclosure.getAttribute('aria-expanded')).toBe('true');
      expect(visibleChildTypes()).toEqual(['text', 'thinking', 'tool_use', 'text']);
      expect(document.querySelector('[data-reasoning-history]')).toBeNull();
      expect(document.body.textContent).toContain('Earlier answer');
      const toolDisclosure = document.querySelector(
        '[data-message-content-block="tool_use"] [data-testid="tool-call-disclosure"]',
      );
      expect(toolDisclosure).toBeTruthy();
      await fireEvent.click(toolDisclosure!);
      expect(document.body.textContent).toContain('done');

      const latestThought = thinking('msg_1:7', 'Latest thought');
      await view.rerender({ content: [...withAnswer, latestThought], isStreaming: true });
      expect(groupDisclosure.getAttribute('aria-expanded')).toBe('true');
      expect(visibleChildTypes()).toEqual(['text', 'thinking', 'tool_use', 'text', 'thinking']);

      await fireEvent.click(groupDisclosure);
      expect(groupDisclosure.getAttribute('aria-expanded')).toBe('false');
      expect(visibleChildTypes()).toEqual(['thinking']);

      await view.rerender({ content: [...withAnswer, latestThought], isStreaming: false });
      expect(visibleChildTypes()).toEqual([]);
    },
  );

  it.each([
    ['MessageContent', renderMessage],
    ['StreamingMessageContent', renderStreaming],
  ])(
    'keeps an adjacent terminal reasoning description inside its open live disclosure in %s',
    async (_renderer, renderMessageContent) => {
      const content = [
        thinking(
          '01a03064:0',
          '\n\n**Assessing delegation and tool availability**\n\n**Planning workspace title setup**',
        ),
        {
          type: 'text' as const,
          id: '01a03064:1',
          text: '<group:Prepping>\nI’ll first title the workspace, read the existing spec, and inspect the project’s dark-mode surface before drafting the implementation plan.',
        },
      ];
      const message = {
        id: 'assistant-adjacent-preview',
        role: 'assistant',
        contentBlocks: content,
        isStreaming: true,
      } as AgentMessage;
      await renderMessageContent(content, true);

      const disclosure = screen.getByTestId('response-group-disclosure');
      expect(screen.getAllByRole('button')).toHaveLength(1);
      expect(screen.queryByTestId('reasoning-disclosure')).toBeNull();
      expect(screen.getByTestId('response-group-name').textContent).toBe(
        'Planning workspace title setup',
      );
      expect(disclosure.getAttribute('aria-expanded')).toBe('true');
      expect(document.body.textContent).not.toContain('Thinking...');
      expect(document.body.textContent?.match(/Planning workspace title setup/g)).toHaveLength(1);
      expect(document.body.textContent).toContain('I’ll first title the workspace');
      expect(document.body.textContent).toContain('Assessing delegation and tool availability');
      expect(findChatSearchMatches([message], 'dark-mode surface', new Map())).toEqual([
        {
          messageId: 'assistant-adjacent-preview',
          matchIndexInMessage: 0,
          occurrenceInBlock: 0,
          turnKey: 'assistant-adjacent-preview',
          blockPath: 'b:0:c:0',
          disclosurePath: ['group:b:0'],
        },
      ]);
      expect(findChatSearchMatches([message], 'Assessing delegation', new Map())).toEqual([]);

      expect(
        document.body.textContent?.match(/Assessing delegation and tool availability/g),
      ).toHaveLength(1);
      expect(document.body.textContent?.match(/I’ll first title the workspace/g)).toHaveLength(1);
      expect(findChatSearchMatches([message], 'Assessing delegation', new Map())).toEqual([]);
      const historyRow = screen.getByTestId('reasoning-history-row');
      expect(historyRow.textContent?.trim()).toBe('Assessing delegation and tool availability');
      expect(historyRow.querySelector('button, [aria-expanded]')).toBeNull();
      expect(document.querySelector('[data-reasoning-history-body]')).toBeNull();
    },
  );

  it('renders adjacent-title history in exact DOM order with the description first', async () => {
    await renderStreaming(
      [
        thinking('msg_1:0', '**Retained predecessor reasoning**\n\n**Model-derived group title**'),
        {
          type: 'text',
          id: 'msg_1:1',
          text: '<group:Prepping>Group description prose.',
        },
        thinking('msg_1:2', 'Subsequent commentary'),
        {
          type: 'tool_use',
          id: 'msg_1:3',
          toolCallId: 'call-1',
          name: 'view',
          input: { summary: 'Run the source-order action' },
        },
        {
          type: 'tool_result',
          id: 'msg_1:4',
          tool_use_id: 'call-1',
          output: 'Source-order result',
        },
        { type: 'text', id: 'msg_1:5', text: 'Final commentary</group:Prepping>' },
      ] as ContentBlock[],
      false,
    );

    expect(screen.getByTestId('response-group-name').textContent).toBe('Model-derived group title');
    const groupDisclosure = screen.getByTestId('response-group-disclosure');
    expect(groupDisclosure.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(groupDisclosure);
    const responseGroup = screen.getByTestId('response-group');
    expect(responseGroup.textContent?.match(/Group description prose\./g)).toHaveLength(1);
    expect(
      [...responseGroup.querySelectorAll('[data-response-group-child]')].map((child) => ({
        type: child.getAttribute('data-message-content-block'),
        text: child.textContent?.replace(/\s+/g, ' ').trim(),
      })),
    ).toEqual([
      { type: 'text', text: 'Group description prose.' },
      { type: 'thinking', text: 'Retained predecessor reasoning' },
      { type: 'thinking', text: 'Subsequent commentary' },
      { type: 'tool_use', text: expect.stringContaining('Run the source-order action') },
      { type: 'text', text: 'Final commentary' },
    ]);

    const toolDisclosure = responseGroup.querySelector(
      '[data-message-content-block="tool_use"] [data-testid="tool-call-disclosure"]',
    );
    expect(toolDisclosure).toBeTruthy();
    await fireEvent.click(toolDisclosure!);
    const orderedText = [
      'Group description prose.',
      'Retained predecessor reasoning',
      'Subsequent commentary',
      'Run the source-order action',
      'Source-order result',
      'Final commentary',
    ].map((text) => screen.getByText(text));
    expect(
      orderedText
        .slice(1)
        .every((node, index) =>
          Boolean(
            orderedText[index].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        ),
    ).toBe(true);
  });

  it.each([
    ['MessageContent', renderStatic],
    ['StreamingMessageContent', (content: ContentBlock[]) => renderStreaming(content, false)],
  ])(
    'normalizes adjacent-title group reasoning without a duplicate generic row in %s',
    async (_, renderMessageContent) => {
      await renderMessageContent([
        thinking(
          'adjacent-normalized:0',
          '**Retained predecessor reasoning**\n\n**Model-provided group title**',
        ),
        {
          type: 'text',
          id: 'adjacent-normalized:1',
          text: '<group:Prepping>Group description prose.',
        },
        thinking('adjacent-normalized:2', 'Reasoning\n\n**Operation body**'),
        { type: 'text', id: 'adjacent-normalized:3', text: '</group:Prepping>' },
      ]);

      const disclosure = screen.getByTestId('response-group-disclosure');
      expect(screen.getByTestId('response-group-name').textContent).toBe(
        'Model-provided group title',
      );
      expect(screen.getAllByRole('button')).toHaveLength(1);

      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
      await fireEvent.click(disclosure);
      expect(disclosure.getAttribute('aria-expanded')).toBe('true');

      const responseGroup = screen.getByTestId('response-group');
      expect(responseGroup.textContent?.match(/Model-provided group title/g)).toHaveLength(1);
      expect(responseGroup.textContent?.match(/Group description prose\./g)).toHaveLength(1);
      expect(responseGroup.textContent?.match(/Reasoning/g)).toBeNull();
      expect(
        [...responseGroup.querySelectorAll('[data-testid="reasoning-history-title"]')].map(
          (title) => title.textContent?.trim(),
        ),
      ).toEqual(['Retained predecessor reasoning', 'Operation body']);
      expect(
        [...responseGroup.querySelectorAll('[data-response-group-child]')].map((child) => ({
          type: child.getAttribute('data-message-content-block'),
          text: child.textContent?.replace(/\s+/g, ' ').trim(),
        })),
      ).toEqual([
        { type: 'text', text: 'Group description prose.' },
        { type: 'thinking', text: 'Retained predecessor reasoning' },
        { type: 'thinking', text: 'Operation body' },
      ]);
    },
  );

  it('renders the alternate-model Prepping wrapper as one reasoning disclosure', async () => {
    const leadingContent = [
      {
        type: 'tool_use',
        id: 'msg_1:0',
        toolCallId: 'call-figma',
        name: 'Figma startup',
        input: { summary: 'Figma startup' },
      },
      { type: 'tool_result', id: 'msg_1:1', tool_use_id: 'call-figma', output: 'Figma ready' },
      thinking('msg_1:2', 'Searching workspace API for title setting'),
    ] as ContentBlock[];
    const opening = [
      ...leadingContent,
      { type: 'text', id: 'msg_1:3', text: '<group:Prepping>' },
    ] as ContentBlock[];
    const view = await renderStreaming(opening, true);
    const visibleChildTypes = () =>
      [...document.querySelectorAll('[data-response-group-child]')].map((child) =>
        child.getAttribute('data-message-content-block'),
      );

    let groupDisclosure = screen.getByTestId('response-group-disclosure');
    expect(groupDisclosure.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('response-group-name').textContent).toBe('Thinking...');
    expect(document.body.textContent).not.toContain('Prepping');
    expect(visibleChildTypes()).toEqual(['thinking']);

    const groupContent = [
      ...leadingContent,
      {
        type: 'text',
        id: 'msg_1:3',
        text: '<group:Prepping>I will set the workspace title. Then I will read the current spec and inspect the screenshot context.',
      },
      thinking('msg_1:4', 'Reasoning\n\n**Invoking workspace API to set title**'),
      {
        type: 'tool_use',
        id: 'msg_1:5',
        toolCallId: 'call-1',
        name: 'workspace_api',
        input: { summary: 'Set workspace title and read the current spec' },
      },
      { type: 'tool_result', id: 'msg_1:6', tool_use_id: 'call-1', output: 'Workspace ready' },
      thinking(
        'msg_1:7',
        'Planning clarification questions on formatting issues\n\n**Planning code inspection and question sequencing**\n\nThe screenshot shows three possible faults: large vertical gaps, raw reasoning rows that stay open, and mixed tool-row indentation.',
      ),
      {
        type: 'tool_use',
        id: 'msg_1:8',
        toolCallId: 'call-2',
        name: 'ask',
        input: { summary: 'Ask for the expected agent chat layout' },
      },
    ] as ContentBlock[];
    await view.rerender({ content: groupContent, isStreaming: true });

    expect(groupDisclosure.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('response-group-name').textContent).toBe(
      'Invoking workspace API to set title',
    );
    expect(document.body.textContent?.match(/Invoking workspace API to set title/g)).toHaveLength(
      1,
    );
    expect(visibleChildTypes()).toEqual(['text', 'thinking', 'tool_use', 'thinking', 'tool_use']);
    expect(document.body.textContent).toContain('Then I will read the current spec');
    const responseGroup = screen.getByTestId('response-group');
    expect(responseGroup.querySelectorAll('[data-testid="reasoning-disclosure"]')).toHaveLength(0);
    expect(responseGroup.textContent?.match(/Reasoning/g)).toBeNull();
    expect(responseGroup.textContent?.match(/Invoking workspace API to set title/g)).toHaveLength(
      1,
    );
    expect(responseGroup.textContent?.match(/Then I will read the current spec/g)).toHaveLength(1);
    const history = [...responseGroup.querySelectorAll('[data-response-group-child]')].map(
      (child) => child.textContent?.trim(),
    );
    expect(history[0]).toContain('I will set the workspace title');
    expect(history[1]).toContain('Searching workspace API for title setting');
    expect(history[2]).toContain('Set workspace title and read the current spec');
    expect(history[3]).toContain('Planning clarification questions on formatting issues');
    expect(history[4]).toContain('Ask for the expected agent chat layout');
    const historyTitles = [
      ...responseGroup.querySelectorAll('[data-testid="reasoning-history-title"]'),
    ].map((title) => title.textContent?.trim());
    expect(historyTitles).toEqual([
      'Searching workspace API for title setting',
      'Planning clarification questions on formatting issues',
      'Planning code inspection and question sequencing',
    ]);
    const historyRows = responseGroup.querySelectorAll('[data-testid="reasoning-history-row"]');
    expect(historyRows).toHaveLength(3);
    expect(
      responseGroup.querySelectorAll('[data-testid="reasoning-history-row"] button'),
    ).toHaveLength(1);
    expect(responseGroup.querySelectorAll('[data-reasoning-history-body]')).toHaveLength(0);
    await fireEvent.click(
      responseGroup.querySelector('[data-testid="reasoning-history-row"] button')!,
    );
    const historyBodies = responseGroup.querySelectorAll('[data-reasoning-history-body]');
    expect(historyBodies).toHaveLength(1);
    expect(historyBodies[0].textContent?.trim()).toBe(
      'The screenshot shows three possible faults: large vertical gaps, raw reasoning rows that stay open, and mixed tool-row indentation.',
    );
    expect(
      responseGroup.textContent?.match(/The screenshot shows three possible faults/g),
    ).toHaveLength(1);
    expect(historyRows[0].querySelector('[data-testid="markdown-viewer"]')).toBeNull();
    const toolDisclosure = document.querySelector(
      '[data-response-group-child][data-message-content-block="tool_use"] [data-testid="tool-call-disclosure"]',
    );
    expect(toolDisclosure).toBeTruthy();
    await fireEvent.click(toolDisclosure!);
    expect(document.body.textContent).toContain('Workspace ready');
    await fireEvent.click(groupDisclosure);
    expect(groupDisclosure.getAttribute('aria-expanded')).toBe('false');
    expect(visibleChildTypes()).toEqual(['tool_use']);
    expect(document.body.textContent).not.toContain('Then I will read the current spec');

    const completedContent = [
      ...groupContent,
      { type: 'text', id: 'msg_1:9', text: '</group:Prepping>Workspace inspection complete.' },
    ] as ContentBlock[];
    await view.rerender({ content: completedContent, isStreaming: false });

    groupDisclosure = screen.getByTestId('response-group-disclosure');
    expect(groupDisclosure.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('response-group-name').textContent).toBe(
      'Invoking workspace API to set title',
    );
    expect(document.body.textContent?.match(/Invoking workspace API to set title/g)).toHaveLength(
      1,
    );
    expect(document.body.textContent).toContain('Workspace inspection complete.');
    expect(document.body.textContent).not.toContain('Prepping');
    expect(document.body.textContent).not.toContain('Then I will read the current spec');

    await fireEvent.click(groupDisclosure);
    expect(groupDisclosure.getAttribute('aria-expanded')).toBe('true');
    expect(visibleChildTypes()).toEqual(['text', 'thinking', 'tool_use', 'thinking', 'tool_use']);
    expect(responseGroup.textContent?.match(/Reasoning/g)).toBeNull();
    expect(responseGroup.textContent?.match(/Invoking workspace API to set title/g)).toHaveLength(
      1,
    );
    expect(responseGroup.textContent?.match(/Then I will read the current spec/g)).toHaveLength(1);
  });

  const persistedHeadinglessPhases = [
    thinking('dark-mode:0', 'I am locating the theme preference before changing the interface.'),
    { type: 'text', id: 'dark-mode:1', text: '<group:Prepping>' },
    {
      type: 'tool_use',
      id: 'dark-mode:2',
      toolCallId: 'theme-call',
      name: 'view',
      input: { path: 'src/theme.ts' },
    },
    {
      type: 'tool_result',
      id: 'dark-mode:3',
      tool_use_id: 'theme-call',
      output: 'Sanitized theme source',
    },
    thinking('dark-mode:4', 'The saved preference and system fallback use separate paths.'),
    { type: 'text', id: 'dark-mode:5', text: '</group:Prepping>Theme storage is understood.' },
    thinking('dark-mode:6', 'I am checking the remaining surfaces before implementation.'),
    { type: 'text', id: 'dark-mode:7', text: '<group:Prepping>' },
    {
      type: 'tool_use',
      id: 'dark-mode:8',
      toolCallId: 'surface-call',
      name: 'view',
      input: { path: 'src/app.css' },
    },
    {
      type: 'tool_result',
      id: 'dark-mode:9',
      tool_use_id: 'surface-call',
      output: 'Sanitized surface source',
    },
    thinking('dark-mode:10', 'The remaining surfaces use shared color tokens.'),
    { type: 'text', id: 'dark-mode:11', text: '</group:Prepping>Dark-mode review complete.' },
  ] as ContentBlock[];

  it.each([
    ['MessageContent', renderStatic],
    ['StreamingMessageContent', (content: ContentBlock[]) => renderStreaming(content, false)],
  ])(
    'renders persisted headingless phases as collapsed disclosures in %s',
    async (_, renderMessage) => {
      await renderMessage(persistedHeadinglessPhases);

      const disclosures = screen.getAllByTestId('response-group-disclosure');
      expect(disclosures).toHaveLength(2);
      expect(disclosures.every((node) => node.getAttribute('aria-expanded') === 'false')).toBe(
        true,
      );
      expect(screen.queryByTestId('reasoning-disclosure')).toBeNull();
      expect(
        document.querySelectorAll('[data-message-content-block="content_group"]'),
      ).toHaveLength(2);
      expect(screen.getAllByRole('button', { name: 'Reasoning' })).toHaveLength(2);
      expect(document.querySelectorAll('[data-chat-search-disclosure-id^="group:"]')).toHaveLength(
        2,
      );
      expect(document.querySelectorAll('[data-tool-use-id]')).toHaveLength(0);
      for (const hiddenText of [
        'I am locating the theme preference',
        'The saved preference and system fallback',
        'I am checking the remaining surfaces',
        'The remaining surfaces use shared color tokens.',
      ]) {
        expect(document.body.textContent).not.toContain(hiddenText);
      }
      expect(document.body.textContent).toContain('Theme storage is understood.');
      expect(document.body.textContent).toContain('Dark-mode review complete.');

      for (const disclosure of disclosures) await fireEvent.click(disclosure);
      const phaseDisclosures = [...screen.getAllByTestId('reasoning-history-row')].map((row) =>
        row.querySelector('button'),
      );
      expect(phaseDisclosures).toHaveLength(4);
      expect(
        phaseDisclosures.every((button) => button?.getAttribute('aria-expanded') === 'false'),
      ).toBe(true);
      for (const phaseDisclosure of phaseDisclosures) await fireEvent.click(phaseDisclosure!);

      const orderedText = [
        'I am locating the theme preference',
        'The saved preference and system fallback',
        'Theme storage is understood.',
        'I am checking the remaining surfaces',
        'The remaining surfaces use shared color tokens.',
        'Dark-mode review complete.',
      ];
      let previousIndex = -1;
      for (const text of orderedText) {
        expect(
          document.body.textContent?.match(new RegExp(text.replaceAll('.', '\\.'), 'g')),
        ).toHaveLength(1);
        const index = document.body.textContent?.indexOf(text) ?? -1;
        expect(index).toBeGreaterThan(previousIndex);
        previousIndex = index;
      }
      expect(document.querySelectorAll('[data-tool-use-id]')).toHaveLength(2);
    },
  );

  it.each([
    ['MessageContent', renderMessage],
    ['StreamingMessageContent', renderStreaming],
  ])(
    'keeps completed headingless phases collapsed until opened in %s',
    async (_, renderMessage) => {
      const active = [
        { type: 'text', id: 'lifecycle:0', text: '<group:Prepping>' },
        thinking('lifecycle:1', 'I am checking the active theme path.'),
        {
          type: 'tool_use',
          id: 'lifecycle:2',
          toolCallId: 'lifecycle-call',
          name: 'view',
          input: { path: 'src/theme.ts' },
        },
      ] as ContentBlock[];
      const view = await renderMessage(active, true);

      const disclosure = screen.getByTestId('response-group-disclosure');
      expect(disclosure.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByTestId('response-group-name').textContent).toBe('Thinking...');
      expect(screen.queryByTestId('reasoning-disclosure')).toBeNull();
      expect(document.querySelectorAll('[data-tool-use-id]')).toHaveLength(1);
      expect(document.body.textContent).not.toContain('I am checking the active theme path.');

      const withFinalResponse = [
        ...active,
        thinking('lifecycle:3', 'The active path is now confirmed.'),
        { type: 'text', id: 'lifecycle:4', text: '</group:Prepping>Theme review complete.' },
      ] as ContentBlock[];
      await view.rerender({ content: withFinalResponse, isStreaming: true });

      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
      expect(document.body.textContent).not.toContain('I am checking the active theme path.');
      expect(document.body.textContent?.match(/Theme review complete\./g)).toHaveLength(1);

      await view.rerender({ content: withFinalResponse, isStreaming: false });

      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByTestId('reasoning-disclosure')).toBeNull();
      expect(screen.getByTestId('response-group-name').textContent).toBe('Reasoning');
      expect(document.querySelectorAll('[data-tool-use-id]')).toHaveLength(0);
      expect(document.body.textContent).not.toContain('I am checking the active theme path.');
      expect(document.body.textContent).not.toContain('The active path is now confirmed.');
      expect(document.body.textContent?.match(/Theme review complete\./g)).toHaveLength(1);

      await fireEvent.click(disclosure);
      const phaseDisclosures = screen
        .getAllByTestId('reasoning-history-row')
        .map((row) => row.querySelector('button'));
      expect(phaseDisclosures).toHaveLength(2);
      expect(
        phaseDisclosures.every((button) => button?.getAttribute('aria-expanded') === 'false'),
      ).toBe(true);
      for (const phaseDisclosure of phaseDisclosures) await fireEvent.click(phaseDisclosure!);
      expect(
        document.body.textContent?.match(/I am checking the active theme path\./g),
      ).toHaveLength(1);
      expect(document.body.textContent?.match(/The active path is now confirmed\./g)).toHaveLength(
        1,
      );
    },
  );

  it.each([
    ['MessageContent', () => import('../MessageContent.svelte')],
    ['StreamingMessageContent', () => import('../StreamingMessageContent.svelte')],
  ] as const)('remounts completed final reasoning collapsed in %s', async (_, loadComponent) => {
    const Component = (await loadComponent()).default;
    const streamingContent = [
      { type: 'text', id: 'remount:0', text: '<group:Prepping>' },
      thinking('remount:1', 'Inspect the live visibility state.'),
    ] as ContentBlock[];
    const first = render(Component, {
      props: { content: streamingContent, isStreaming: true, isLastConversationMessage: true },
    });
    expect(first.getByTestId('response-group-disclosure').getAttribute('aria-expanded')).toBe(
      'true',
    );
    first.unmount();

    const restored = render(Component, {
      props: {
        content: [
          ...streamingContent,
          { type: 'text', id: 'remount:2', text: '</group:Prepping>Final answer.' },
        ],
        isStreaming: false,
        isLastConversationMessage: true,
      },
    });
    const restoredDisclosure = restored.getByTestId('response-group-disclosure');
    expect(restoredDisclosure.getAttribute('aria-expanded')).toBe('false');
    expect(restored.queryByText('Inspect the live visibility state.')).toBeNull();
    expect(restored.getByText('Final answer.')).toBeTruthy();
  });

  it('keeps the exact screenshot history shape in the static message path', async () => {
    await renderStatic([
      { type: 'text', id: 'msg_1:0', text: '<group:Prepping>Group description prose.' },
      thinking('msg_1:1', 'Reasoning\n\n**Title-only operation**'),
      thinking('msg_1:2', 'Earlier operation\n\n**Current operation**\n\nSubordinate body.'),
      { type: 'text', id: 'msg_1:3', text: '</group:Prepping>' },
    ]);

    const groupDisclosure = screen.getByTestId('response-group-disclosure');
    expect(screen.getByTestId('response-group-name').textContent).toBe('Title-only operation');
    expect(groupDisclosure.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(groupDisclosure);
    expect(groupDisclosure.getAttribute('aria-expanded')).toBe('true');
    const responseGroup = screen.getByTestId('response-group');
    expect(
      responseGroup.querySelectorAll('[data-testid="response-group-disclosure"]'),
    ).toHaveLength(1);
    expect(responseGroup.querySelectorAll('[data-testid="reasoning-disclosure"]')).toHaveLength(0);
    expect(
      [...responseGroup.querySelectorAll('[data-testid="reasoning-history-title"]')].map((title) =>
        title.textContent?.trim(),
      ),
    ).toEqual(['Earlier operation', 'Current operation']);
    expect(responseGroup.textContent?.match(/Title-only operation/g)).toHaveLength(1);
    expect(responseGroup.textContent?.match(/Reasoning/g)).toBeNull();
    expect(responseGroup.querySelectorAll('[data-reasoning-history-body]')).toHaveLength(0);
    expect(responseGroup.textContent?.match(/Subordinate body\./g)).toBeNull();
    expect(responseGroup.textContent?.match(/Group description prose\./g)).toHaveLength(1);
    expect(
      responseGroup.querySelectorAll('[data-testid="reasoning-history-row"] button'),
    ).toHaveLength(1);
    await fireEvent.click(
      responseGroup.querySelector('[data-testid="reasoning-history-row"] button')!,
    );
    expect(responseGroup.querySelectorAll('[data-reasoning-history-body]')).toHaveLength(1);
    expect(responseGroup.textContent?.match(/Subordinate body\./g)).toHaveLength(1);
  });

  it('renders every consecutive screenshot title as a compact row without Markdown leakage', async () => {
    const titles = [
      'Assessing delegation and tool availability',
      'Inspecting workspace_api method names',
      'Searching workspace.set method descriptions',
      'Planning workspace API title setting',
    ];
    await renderStatic([
      { type: 'text', id: 'msg_1:0', text: '<group:Prepping>Description before history.' },
      thinking(
        'msg_1:1',
        [
          'Reasoning',
          `**${titles[0]}**`,
          `**${titles[1]}**`,
          `**${titles[2]}**`,
          `**${titles[3]}**`,
          'History body after every title.',
        ].join('\n\n'),
      ),
      { type: 'text', id: 'msg_1:2', text: '</group:Prepping>' },
    ]);

    expect(screen.getByTestId('response-group-name').textContent).toBe(titles[0]);
    const groupDisclosure = screen.getByTestId('response-group-disclosure');
    expect(groupDisclosure.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(groupDisclosure);
    const responseGroup = screen.getByTestId('response-group');
    expect(
      [...responseGroup.querySelectorAll('[data-testid="reasoning-history-title"]')].map((title) =>
        title.textContent?.trim(),
      ),
    ).toEqual(titles.slice(1));
    expect(responseGroup.querySelectorAll('[data-testid="reasoning-history-row"]')).toHaveLength(3);
    expect(
      responseGroup.querySelectorAll('[data-testid="reasoning-history-row"] button'),
    ).toHaveLength(1);
    expect(responseGroup.querySelector('[data-reasoning-history-body]')).toBeNull();
    await fireEvent.click(
      responseGroup.querySelector('[data-testid="reasoning-history-row"] button')!,
    );
    expect(responseGroup.querySelector('[data-reasoning-history-body]')?.textContent?.trim()).toBe(
      'History body after every title.',
    );
    expect(
      responseGroup.querySelector('[data-reasoning-history-body] h1, h2, h3, h4, h5, h6'),
    ).toBeNull();
    for (const title of titles) {
      expect(
        responseGroup.textContent?.match(new RegExp(title.replace('.', '\\.'), 'g')),
      ).toHaveLength(1);
    }
    expect(responseGroup.textContent?.match(/Description before history\./g)).toHaveLength(1);
    expect(responseGroup.textContent?.match(/History body after every title\./g)).toHaveLength(1);
    expect(responseGroup.textContent?.match(/Reasoning/g)).toBeNull();
  });

  it.each([
    ['MessageContent', renderStatic],
    ['StreamingMessageContent', (content: ContentBlock[]) => renderStreaming(content, false)],
  ])(
    'renders headingless group reasoning under a localized compact row in %s',
    async (_, renderPath) => {
      await renderPath([
        { type: 'text', id: 'headingless:0', text: '<group:Prepping>Description.' },
        thinking(
          'headingless:1',
          'This paragraph explains the completed check without presenting itself as a heading.',
        ),
        { type: 'text', id: 'headingless:2', text: '</group:Prepping>' },
      ]);

      const groupDisclosure = screen.getByTestId('response-group-disclosure');
      expect(groupDisclosure.getAttribute('aria-expanded')).toBe('false');
      await fireEvent.click(groupDisclosure);
      expect(screen.getByTestId('reasoning-history-title').textContent?.trim()).toBe('Reasoning');
      expect(document.querySelector('[data-reasoning-history-body]')).toBeNull();
      const phaseDisclosure = screen.getByTestId('reasoning-history-row').querySelector('button');
      expect(phaseDisclosure?.getAttribute('aria-expanded')).toBe('false');
      await fireEvent.click(phaseDisclosure!);
      expect(document.querySelector('[data-reasoning-history-body]')?.textContent?.trim()).toBe(
        'This paragraph explains the completed check without presenting itself as a heading.',
      );
      expect(phaseDisclosure?.getAttribute('aria-expanded')).toBe('true');
    },
  );

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
    const toggle = screen.getByRole('button', { name: 'Reasoning' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(toggle);
    expect(document.body.textContent).toContain('Hidden reasoning');
    expect(
      [...document.querySelectorAll('.content-block--text')].some((block) =>
        block.textContent?.includes('Visible answer'),
      ),
    ).toBe(true);
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
    // containing [thinking, tool_use, thinking, text]. Open the group to inspect
    // all children: only the final text must still receive streaming state.
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

    await fireEvent.click(screen.getByTestId('response-group-disclosure'));

    const thinkingRows = document.querySelectorAll('.content-block--thinking');
    expect(thinkingRows).toHaveLength(2);
    for (const row of thinkingRows) {
      expect(row.querySelector('[data-operational-leading]')?.className).not.toContain(
        'animate-pulse',
      );
      expect(row.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false');
    }

    const streamingViewers = [
      ...document.querySelectorAll('[data-testid="markdown-viewer"]'),
    ].filter((viewer) => viewer.getAttribute('data-streaming') === 'true');
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

    await fireEvent.click(screen.getByTestId('response-group-disclosure'));

    const thinkingRows = document.querySelectorAll('.content-block--thinking');
    expect(thinkingRows).toHaveLength(2);
    expect(thinkingRows[0].querySelector('[data-operational-leading]')?.className).not.toContain(
      'animate-pulse',
    );
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
    // A paired tool_result child is rendered inside its visible tool_use — a
    // trailing one must not steal the streaming flag from the final group child.
    await renderStreaming(
      [
        {
          type: 'tool_use',
          id: 'msg_1:0',
          toolCallId: 'call_1',
          name: 'view',
          input: { path: 'src/example.ts' },
        },
        { type: 'text', id: 'msg_1:1', text: '<group:Working>' },
        thinking('msg_1:2', 'Reasoning while a result trails'),
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
