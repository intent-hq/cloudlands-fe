/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: vi.fn() });
});

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: { select: () => undefined },
}));

vi.mock('../tool-classifier', async () => {
  const { faWrench } = await import('@fortawesome/free-solid-svg-icons');
  return {
    classifyTool: (name: string) => {
      if (name === 'note-tool') {
        return { verb: 'Open', subject: 'Spec note', noteId: 'spec', icon: faWrench };
      }
      if (name === 'file-tool') {
        return {
          verb: 'Read',
          subject: 'QuestionWizard.svelte',
          filePath: 'src/QuestionWizard.svelte',
          path: 'src/lib/components/chat/questions',
          icon: faWrench,
        };
      }
      if (name === 'path-tool') {
        return { verb: 'Search', subject: '', path: 'src/lib/components/chat', icon: faWrench };
      }
      return { verb: 'Run', subject: 'operational task', icon: faWrench };
    },
    isContextEngineTool: () => false,
  };
});

vi.mock('../tool-result-parser', () => ({
  parseToolResult: (name: string, _input: unknown, result: unknown) =>
    name === 'codebase-retrieval'
      ? { type: 'unknown', content: typeof result === 'string' ? result : 'Retrieved result' }
      : { type: 'unknown' },
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));
vi.mock('../ToolDetails.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/editor/CodeBlock.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/markdown/MarkdownViewer.svelte', async () => ({
  default: (await import('./mocks/MarkdownViewerStub.svelte')).default,
}));
vi.mock('$lib/components/settings/mcp/McpIcon.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));
vi.mock('$features/agent/components/auggie-avatar/AuggieAvatar.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

import ContextEngineToolCall from '../ContextEngineToolCall.svelte';
import ResponseGroup from '../ResponseGroup.svelte';
import ThinkingBlock from '../ThinkingBlock.svelte';
import ToolCall from '../ToolCall.svelte';
import {
  COMPACT_TOOL_ICON_BOX_CLASS,
  COMPACT_TOOL_ROW_CLASS,
  COMPACT_TOOL_SENTENCE_CLASS,
  OPERATIONAL_EXPANDED_CONTENT_CLASS,
  OPERATIONAL_ICON_BOX_CLASS,
  OPERATIONAL_ICON_CLASS,
  OPERATIONAL_ROW_LINE_CLASS,
  OPERATIONAL_SECONDARY_CLASS,
  OPERATIONAL_ROW_TONE_CLASS,
  OPERATIONAL_SUMMARY_CLASS,
} from '../operational-disclosure-row';

const genericTool = { id: 'tool-generic', name: 'shell', input: { command: 'pnpm test' } } as any;
const contextTool = {
  id: 'tool-context',
  name: 'codebase-retrieval',
  input: { information_request: 'Where is the operational row implemented?' },
} as any;
const children = createRawSnippet(() => ({ render: () => '<div>Expanded group content</div>' }));

afterEach(cleanup);

function expectClasses(element: Element, contract: string) {
  for (const token of contract.split(' ')) expect(element.className).toContain(token);
}

function expectRenderedContract(container: HTMLElement, summary: Element, compact = false) {
  const row = container.querySelector('[data-operational-disclosure-row]')!;
  expectClasses(row, compact ? COMPACT_TOOL_ROW_CLASS : OPERATIONAL_ROW_LINE_CLASS);
  expectClasses(summary, compact ? COMPACT_TOOL_SENTENCE_CLASS : OPERATIONAL_SUMMARY_CLASS);
  container.style.width = '120px';
  expect(row.scrollWidth).toBeLessThanOrEqual(container.scrollWidth);
}

describe('shared operational disclosure-row contract', () => {
  it('renders the same body-sized tone, geometry, and narrow containment across all consumers', () => {
    const cases = [
      () => {
        const view = render(ToolCall, {
          props: { toolUse: genericTool, toolState: 'completed', result: 'passed' },
        });
        return {
          view,
          host: view.container.firstElementChild!,
          summary: screen.getByTestId('tool-call-summary'),
          compact: true,
        };
      },
      () => {
        const view = render(ContextEngineToolCall, {
          props: { toolUse: contextTool, toolState: 'completed', result: 'Retrieved result' },
        });
        return {
          view,
          host: screen.getByTestId('context-engine-tool-call'),
          summary: screen.getByTestId('context-engine-query'),
          compact: true,
        };
      },
      () => {
        const view = render(ThinkingBlock, { props: { content: 'Inspect the shared row' } });
        return {
          view,
          host: screen.getByTestId('reasoning-tool-call'),
          summary: screen.getByTestId('reasoning-summary'),
          compact: false,
        };
      },
      () => {
        const view = render(ResponseGroup, {
          props: {
            name: 'Operational group',
            blocks: [{ type: 'text', text: 'Progress' }] as any,
            children,
          },
        });
        const row = view.container.querySelector('[data-operational-disclosure-row]')!;
        return {
          view,
          host: row,
          summary: screen.getByTestId('response-group-summary'),
          compact: false,
        };
      },
    ];

    for (const setup of cases) {
      const { view, host, summary, compact } = setup();
      expectClasses(host, OPERATIONAL_ROW_TONE_CLASS);
      expectRenderedContract(view.container, summary, compact);
      cleanup();
    }
  });

  it('keeps running icons readable and stateful without reintroducing decorative group icons', () => {
    render(ToolCall, { props: { toolUse: genericTool, toolState: 'running' } });
    const toolIcon = screen
      .getByTestId('tool-call-summary')
      .parentElement!.querySelector('[data-tool-icon]')!;
    expectClasses(toolIcon, COMPACT_TOOL_ICON_BOX_CLASS);
    expect(toolIcon.className).toContain('animate-pulse');
    cleanup();

    render(ContextEngineToolCall, { props: { toolUse: contextTool, toolState: 'running' } });
    const searchIcon = screen
      .getByTestId('context-engine-tool-call')
      .querySelector('[data-tool-icon]')!;
    expectClasses(searchIcon, COMPACT_TOOL_ICON_BOX_CLASS);
    expect(searchIcon.className).toContain('animate-pulse');
    cleanup();

    render(ThinkingBlock, { props: { content: 'Thinking', isStreaming: true } });
    const brain = screen.getByTestId('reasoning-tool-call').querySelector('[data-icon="brain"]')!;
    expectClasses(brain, OPERATIONAL_ICON_CLASS);
    expect(brain.className).toContain('animate-pulse');
    cleanup();

    const group = render(ResponseGroup, {
      props: { name: 'Streaming group', isStreaming: true, children },
    });
    const groupIconBox = group.container.querySelector('[data-operational-icon-box]')!;
    expectClasses(groupIconBox, OPERATIONAL_ICON_BOX_CLASS);
    expect(groupIconBox.querySelector('[data-icon="arrows-in-line-vertical"]')).toBeTruthy();
  });

  it('uses the shared expanded-content header gap for reasoning and response groups', async () => {
    const reasoning = render(ThinkingBlock, { props: { content: 'Expanded reasoning' } });
    await fireEvent.click(screen.getByRole('button', { name: /Reasoning/ }));
    expectClasses(
      reasoning.container.querySelector('[data-operational-expanded-content]')!,
      OPERATIONAL_EXPANDED_CONTENT_CLASS,
    );
    cleanup();

    const group = render(ResponseGroup, { props: { name: 'Group', children } });
    await fireEvent.click(group.container.querySelector('button')!);
    expectClasses(
      group.container.querySelector('[data-operational-expanded-content]')!,
      OPERATIONAL_EXPANDED_CONTENT_CLASS,
    );
  });

  it('preserves completed and error disclosure semantics and specialized expanded content', async () => {
    render(ToolCall, {
      props: { toolUse: genericTool, toolState: 'error', result: 'Command failed' },
    });
    const genericDisclosure = screen.getByRole('button', { name: /Run operational task/ });
    expect(genericDisclosure.getAttribute('aria-controls')).toBe('tool-details-tool-generic');
    await fireEvent.keyDown(genericDisclosure, { key: 'Enter' });
    expect(document.querySelector('#tool-details-tool-generic')).toBeTruthy();
    cleanup();

    render(ContextEngineToolCall, {
      props: { toolUse: contextTool, toolState: 'error', result: 'Search failed' },
    });
    const contextDisclosure = screen.getByRole('button', { name: /Search codebase/ });
    expect(contextDisclosure.getAttribute('aria-expanded')).toBe('false');
    expect(contextDisclosure.getAttribute('aria-controls')).toBe(
      'context-engine-details-tool-context',
    );
    await fireEvent.keyDown(contextDisclosure, { key: ' ' });
    expect(contextDisclosure.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('context-engine-brand').textContent).toContain(
      'Augment Context Engine',
    );
    expect(screen.getByText('Search failed')).toBeTruthy();
  });

  it.each(['completed', 'error'] as const)(
    'never renders middle-dot separators for %s tool rows',
    (toolState) => {
      const { container } = render(ToolCall, {
        props: {
          toolUse: genericTool,
          toolState,
          result: toolState === 'error' ? 'Command failed' : 'passed',
        },
      });
      expect(container.textContent).not.toContain('·');
    },
  );

  it('keeps the single sentence meaningful while its fixed icon remains quiet', () => {
    render(ToolCall, {
      props: { toolUse: genericTool, toolState: 'completed', result: 'passed' },
    });
    const summary = screen.getByTestId('tool-call-summary');
    expectClasses(summary, COMPACT_TOOL_SENTENCE_CLASS);
    expectClasses(
      summary.parentElement!.querySelector('[data-tool-icon]')!,
      OPERATIONAL_SECONDARY_CLASS,
    );
    expect(summary.className).toContain('focus-visible:text-foreground');
    cleanup();

    render(ContextEngineToolCall, {
      props: { toolUse: contextTool, toolState: 'completed', result: 'Retrieved result' },
    });
    const query = screen.getByTestId('context-engine-query');
    expectClasses(query, COMPACT_TOOL_SENTENCE_CLASS);
    expectClasses(
      query.parentElement!.querySelector('[data-tool-icon]')!,
      OPERATIONAL_SECONDARY_CLASS,
    );
  });

  it.each([
    ['note-tool', 'tool-call-note-link', false],
    ['file-tool', 'tool-call-file-link', true],
  ])(
    'keeps the %s action in the readable sentence flow at wide and narrow widths',
    (name, testId, isInline) => {
      const { container } = render(ToolCall, {
        props: {
          toolUse: { id: `tool-${name}`, name, input: {} } as any,
          toolState: 'completed',
          result: 'done',
          workspaceId: 'ws-1',
        },
      });
      const row = container.querySelector('[data-operational-disclosure-row]')!;
      const sentence = row.querySelector('[data-tool-sentence]')!;
      const action = screen.getByTestId(testId);
      expectClasses(sentence, COMPACT_TOOL_SENTENCE_CLASS);
      if (isInline) {
        expect(sentence.contains(action)).toBe(true);
        expect(action.className).toContain('min-w-0');
        expect(action.className).toContain('truncate');
      } else {
        expect(
          sentence.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(action.className).toContain('shrink-0');
      }
      expect(row.className).not.toContain('justify-between');
      expect(row.querySelector('.ml-auto')).toBeNull();

      container.style.width = '120px';
      expect(row.className).toContain('overflow-hidden');
      expect(sentence.className).toContain('min-w-0');
      expect(sentence.className).toContain('truncate');
    },
  );

  it('keeps plain, path, context-engine, and error fragments left-flowing', () => {
    const cases = [
      { toolUse: genericTool, result: 'done' },
      { toolUse: { id: 'tool-path', name: 'path-tool', input: {} } as any, result: 'done' },
      { toolUse: genericTool, result: 'failed', toolState: 'error' as const },
    ];
    for (const props of cases) {
      const view = render(ToolCall, { props: { toolState: 'completed', ...props } });
      const row = view.container.querySelector('[data-operational-disclosure-row]')!;
      expect(row.className).not.toContain('justify-between');
      expect(row.querySelector('.ml-auto')).toBeNull();
      expect(row.querySelector('[class*="flex-1"]')).toBeNull();
      cleanup();
    }

    render(ContextEngineToolCall, {
      props: { toolUse: contextTool, toolState: 'error', result: 'failed' },
    });
    const contextRow = screen
      .getByTestId('context-engine-tool-call')
      .querySelector('[data-operational-disclosure-row]')!;
    expect(contextRow.querySelector('.ml-auto')).toBeNull();
    expect(contextRow.className).not.toContain('justify-between');
  });
});
