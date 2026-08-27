/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentBlock, ToolUseBlock } from '$shared/types';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: vi.fn() });
});

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: { select: () => undefined },
}));

vi.mock('$lib/utils/tool-classifier', async () => {
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
vi.mock('$features/agent/components/agent-avatar/AgentAvatar.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

import ContextEngineToolCall from '../ContextEngineToolCall.svelte';
import ChatOperationalRow from '../ChatOperationalRow.svelte';
import ResponseGroup from '../ResponseGroup.svelte';
import ThinkingBlock from '../ThinkingBlock.svelte';
import ToolCall from '../ToolCall.svelte';
import {
  CHAT_OPERATIONAL_ICON_CLASS,
  CHAT_OPERATIONAL_LEADING_CLASS,
  CHAT_OPERATIONAL_CONTAINER_CLASS,
  CHAT_OPERATIONAL_ROW_CLASS,
  CHAT_OPERATIONAL_SUMMARY_CLASS,
  CHAT_OPERATIONAL_SUMMARY_TONE_CLASS,
  OPERATIONAL_EXPANDED_CONTENT_CLASS,
  OPERATIONAL_GROUP_CONTENT_CLASS,
  OPERATIONAL_PRIMARY_CLASS,
  OPERATIONAL_ROW_LINE_CLASS,
  OPERATIONAL_SECONDARY_CLASS,
  OPERATIONAL_ROW_TONE_CLASS,
  OPERATIONAL_SUMMARY_CLASS,
  safeOperationalDetailsTransition,
} from '../operational-disclosure-row';

function createToolUse(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): ToolUseBlock {
  return { type: 'tool_use', id, name, input };
}

const genericTool = createToolUse('tool-generic', 'shell', { command: 'pnpm test' });
const contextTool = createToolUse('tool-context', 'codebase-retrieval', {
  information_request: 'Where is the operational row implemented?',
});
const groupBlocks: ContentBlock[] = [{ type: 'text', text: 'Progress' }];
const children = createRawSnippet(() => ({ render: () => '<div>Expanded group content</div>' }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function expectClasses(element: Element, contract: string) {
  for (const token of contract.split(' ')) expect(element.className).toContain(token);
}

function expectRenderedContract(container: HTMLElement, summary: Element, shared = false) {
  const row = container.querySelector('[data-operational-disclosure-row]')!;
  expectClasses(row, shared ? CHAT_OPERATIONAL_ROW_CLASS : OPERATIONAL_ROW_LINE_CLASS);
  expectClasses(summary, shared ? CHAT_OPERATIONAL_SUMMARY_CLASS : OPERATIONAL_SUMMARY_CLASS);
  container.style.width = '120px';
  expect(row.scrollWidth).toBeLessThanOrEqual(container.scrollWidth);
}

describe('shared operational disclosure-row contract', () => {
  it('renders response-group chevrons left when closed and down when open', async () => {
    const leading = createRawSnippet(() => ({ render: () => '<span>Lead</span>' }));
    const summary = createRawSnippet(() => ({ render: () => '<span>Summary</span>' }));
    const view = render(ChatOperationalRow, {
      props: { leading, summary, interactive: true, expanded: false },
    });
    const chevron = view.container.querySelector('[data-operational-chevron] .fa-icon')!;

    expect(chevron.getAttribute('data-icon')).toBe('chevron-down');
    expect(chevron.classList.contains('rotate-90')).toBe(true);

    await view.rerender({ leading, summary, interactive: true, expanded: true });
    expect(chevron.classList.contains('rotate-90')).toBe(false);
  });

  it('keeps the shared muted tone immutable through hover and focus class paths', () => {
    const { container } = render(ThinkingBlock, { props: { content: 'Stable reasoning' } });
    const row = container.querySelector('[data-chat-operational-row]')!;
    const leading = container.querySelector('[data-operational-leading]')!;
    const summary = container.querySelector('[data-operational-summary]')!;

    for (const element of [row, leading, summary]) {
      expect(element.className).toContain('text-muted-foreground');
      expect(element.className).not.toMatch(
        /(?:group-)?(?:hover|focus|focus-visible|focus-within):(?:text|bg|border|opacity)/,
      );
    }
  });

  it('uses zero-duration detail motion when reduced motion is preferred', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ height: '40px' } as CSSStyleDeclaration);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    expect(safeOperationalDetailsTransition(document.createElement('div')).duration).toBe(0);

    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    expect(safeOperationalDetailsTransition(document.createElement('div')).duration).toBe(150);
  });

  it('renders the same body-sized tone, geometry, and narrow containment across all consumers', () => {
    const cases = [
      () => {
        const view = render(ToolCall, {
          props: { toolUse: genericTool, toolState: 'completed', result: 'passed' },
        });
        return {
          view,
          host: view.container.firstElementChild!,
          summary: screen
            .getByTestId('tool-call-disclosure')
            .querySelector('[data-tool-sentence]')!,
          shared: true,
        };
      },
      () => {
        const view = render(ContextEngineToolCall, {
          props: { toolUse: contextTool, toolState: 'completed', result: 'Retrieved result' },
        });
        return {
          view,
          host: screen.getByTestId('context-engine-tool-call'),
          summary: screen
            .getByTestId('context-engine-disclosure')
            .querySelector('[data-tool-sentence]')!,
          shared: true,
        };
      },
      () => {
        const view = render(ThinkingBlock, { props: { content: 'Inspect the shared row' } });
        return {
          view,
          host: screen.getByTestId('reasoning-tool-call'),
          summary: screen.getByTestId('reasoning-summary'),
          shared: true,
        };
      },
      () => {
        const view = render(ResponseGroup, {
          props: {
            name: 'Operational group',
            blocks: groupBlocks,
            children,
          },
        });
        const row = view.container.querySelector('[data-operational-disclosure-row]')!;
        return {
          view,
          host: row.closest('[data-chat-operational-row]')!,
          summary: screen.getByTestId('response-group-summary'),
          shared: true,
        };
      },
    ];

    for (const setup of cases) {
      const { view, host, summary, shared } = setup();
      expectClasses(host, shared ? CHAT_OPERATIONAL_CONTAINER_CLASS : OPERATIONAL_ROW_TONE_CLASS);
      expectRenderedContract(view.container, summary, shared);
      if (shared) expect(host.hasAttribute('data-chat-operational-row')).toBe(true);
      cleanup();
    }
  });

  it.each([
    [
      'ToolCall',
      () => render(ToolCall, { props: { toolUse: genericTool, adjacentOperationalRow: true } }),
    ],
    [
      'ContextEngineToolCall',
      () =>
        render(ContextEngineToolCall, {
          props: { toolUse: contextTool, adjacentOperationalRow: true },
        }),
    ],
    [
      'ThinkingBlock',
      () =>
        render(ThinkingBlock, {
          props: { content: 'Shared reasoning', adjacentOperationalRow: true },
        }),
    ],
  ])('%s delegates its shell and adjacent spacing to ChatOperationalRow', (_name, setup) => {
    const view = setup();
    const sharedRow = view.container.querySelector('[data-chat-operational-row]')!;
    expect(sharedRow).toBeTruthy();
    expect(sharedRow.className).not.toContain('mt-1');
    expect(sharedRow.getAttribute('data-adjacent-operational-row')).toBe('true');
    expectClasses(
      sharedRow.querySelector('[data-operational-disclosure-row]')!,
      CHAT_OPERATIONAL_ROW_CLASS,
    );
  });

  it('gives response groups the same adjacent operational-row contract', () => {
    const view = render(ResponseGroup, {
      props: { name: 'Resume', adjacentOperationalRow: true, children },
    });
    const row = view.container.querySelector('[data-operational-row-container]')!;
    expect(row.className).not.toContain('mt-1');
    expect(row.getAttribute('data-adjacent-operational-row')).toBe('true');
  });

  it('renders only eye, hand, and brain leading glyphs at 16px', () => {
    const expectLeadingIcon = (container: HTMLElement, name: string) => {
      const leading = container.querySelector('[data-operational-leading]')!;
      const icon = container.querySelector('[data-operational-leading] [data-icon]')!;
      expect(icon.getAttribute('data-icon')).toBe(name);
      expectClasses(icon, CHAT_OPERATIONAL_ICON_CLASS);
      expect(leading.className).toContain('size-[var(--operational-leading-slot-size)]');
      expect(leading.className).toContain('items-center');
      expect(leading.className).toContain('justify-center');
      expect(container.querySelector('[data-operational-leading] img')).toBeNull();
    };

    expectLeadingIcon(render(ToolCall, { props: { toolUse: genericTool } }).container, 'hand');
    cleanup();
    expectLeadingIcon(
      render(ToolCall, { props: { toolUse: createToolUse('view', 'view') } }).container,
      'eye',
    );
    cleanup();
    expectLeadingIcon(
      render(ToolCall, {
        props: { toolUse: createToolUse('mcp-view', 'mcp__figma__get_screenshot') },
      }).container,
      'eye',
    );
    cleanup();
    expectLeadingIcon(
      render(ContextEngineToolCall, { props: { toolUse: contextTool } }).container,
      'eye',
    );
    cleanup();
    expectLeadingIcon(
      render(ThinkingBlock, { props: { content: 'Reasoning' } }).container,
      'brain',
    );
  });

  it('keeps leading running icons as the only active tool cue', () => {
    const { container } = render(ToolCall, {
      props: { toolUse: genericTool, toolState: 'running' },
    });
    const toolIcon = container.querySelector('[data-tool-icon]')!;
    expectClasses(toolIcon, CHAT_OPERATIONAL_LEADING_CLASS);
    expect(toolIcon.className).toContain('animate-pulse');
    cleanup();

    render(ContextEngineToolCall, { props: { toolUse: contextTool, toolState: 'running' } });
    const searchIcon = screen
      .getByTestId('context-engine-tool-call')
      .querySelector('[data-tool-icon]')!;
    expectClasses(searchIcon, CHAT_OPERATIONAL_LEADING_CLASS);
    expect(searchIcon.className).toContain('animate-pulse');
    expect(screen.queryByTestId('tool-call-status')).toBeNull();
    expect(document.querySelector('[data-operational-trailing]')).toBeNull();
    cleanup();

    render(ThinkingBlock, { props: { content: 'Thinking', isStreaming: true } });
    const brain = screen.getByTestId('reasoning-tool-call').querySelector('[data-icon="brain"]')!;
    expectClasses(brain, CHAT_OPERATIONAL_ICON_CLASS);
    expect(brain.className).toContain('animate-pulse');
    cleanup();

    const group = render(ResponseGroup, {
      props: { name: 'Streaming group', isStreaming: true, children },
    });
    const groupIconBox = group.container.querySelector('[data-operational-icon-box]')!;
    expectClasses(groupIconBox, CHAT_OPERATIONAL_LEADING_CLASS);
    expect(groupIconBox.querySelector('[data-icon="arrows-out-line-vertical"]')).toBeTruthy();
    expect(group.container.querySelector('[data-operational-chevron]')).toBeNull();
  });

  it('keeps reasoning indented and centers the response-group guide on its header icon', async () => {
    const reasoning = render(ThinkingBlock, { props: { content: 'Expanded reasoning' } });
    await fireEvent.click(screen.getByTestId('reasoning-disclosure'));
    expectClasses(
      reasoning.container.querySelector('[data-operational-expanded-content]')!,
      OPERATIONAL_EXPANDED_CONTENT_CLASS,
    );
    expect(
      reasoning.container.querySelector('[data-operational-expanded-content]')?.className,
    ).toContain('pb-2');
    cleanup();

    const group = render(ResponseGroup, { props: { name: 'Group', children } });
    await fireEvent.click(group.container.querySelector('button')!);
    const expanded = group.container.querySelector('[data-operational-expanded-content]')!;
    expectClasses(expanded, OPERATIONAL_GROUP_CONTENT_CLASS);
    const guide = group.container.querySelector('[data-operational-expanded-guide]')!;
    expect(guide).toBeTruthy();
    expect(guide.className).toContain('operational-group-guide');
    expect(expanded.className).not.toContain('pl-');
  });

  it('adds bottom space only while a response group is expanded', async () => {
    const group = render(ResponseGroup, { props: { name: 'Group', children } });
    const container = group.container.querySelector('[data-operational-row-container]')!;
    const trigger = screen.getByTestId('response-group-disclosure');

    expect(container.classList.contains('mb-3')).toBe(false);
    await fireEvent.click(trigger);
    expect(container.classList.contains('mb-3')).toBe(true);

    await fireEvent.click(trigger);
    expect(container.classList.contains('mb-3')).toBe(false);
  });

  it('preserves completed and error disclosure semantics and specialized expanded content', async () => {
    render(ToolCall, {
      props: { toolUse: genericTool, toolState: 'error', result: 'Command failed' },
    });
    const genericDisclosure = screen.getByTestId('tool-call-disclosure');
    expect(genericDisclosure.getAttribute('aria-controls')).toBe('tool-details-tool-generic');
    await fireEvent.keyDown(genericDisclosure, { key: 'Enter' });
    expect(document.querySelector('#tool-details-tool-generic')).toBeTruthy();
    cleanup();

    render(ContextEngineToolCall, {
      props: { toolUse: contextTool, toolState: 'error', result: 'Search failed' },
    });
    const failedStatus = screen.getByTestId('tool-call-status');
    expect(failedStatus.getAttribute('aria-label')).toBe('Failed');
    expect(failedStatus.querySelector('[data-icon="circle-xmark"]')).toBeTruthy();
    const contextDisclosure = screen.getByTestId('context-engine-disclosure');
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

  it('uses one muted sentence treatment and fixed icon treatment', () => {
    render(ToolCall, {
      props: { toolUse: genericTool, toolState: 'completed', result: 'passed' },
    });
    const disclosure = screen.getByTestId('tool-call-disclosure');
    const summary = disclosure.querySelector('[data-tool-sentence]')!;
    expectClasses(summary, CHAT_OPERATIONAL_SUMMARY_CLASS);
    expectClasses(summary, CHAT_OPERATIONAL_SUMMARY_TONE_CLASS);
    expect(disclosure.querySelectorAll('[data-tool-primary]').length).toBeGreaterThan(0);
    for (const primary of disclosure.querySelectorAll('[data-tool-primary]')) {
      expect(primary.className).not.toContain(OPERATIONAL_PRIMARY_CLASS);
    }
    for (const secondary of disclosure.querySelectorAll('[data-tool-secondary]')) {
      expect(secondary.className).not.toContain(OPERATIONAL_SECONDARY_CLASS);
    }
    expectClasses(disclosure.querySelector('[data-tool-icon]')!, CHAT_OPERATIONAL_LEADING_CLASS);
    expect(disclosure.tagName).toBe('BUTTON');
    cleanup();

    render(ContextEngineToolCall, {
      props: { toolUse: contextTool, toolState: 'completed', result: 'Retrieved result' },
    });
    const contextDisclosure = screen.getByTestId('context-engine-disclosure');
    const query = contextDisclosure.querySelector('[data-tool-sentence]')!;
    expectClasses(query, CHAT_OPERATIONAL_SUMMARY_CLASS);
    expectClasses(query, CHAT_OPERATIONAL_SUMMARY_TONE_CLASS);
    expect(contextDisclosure.querySelectorAll('[data-tool-primary]').length).toBeGreaterThan(0);
    for (const primary of contextDisclosure.querySelectorAll('[data-tool-primary]')) {
      expect(primary.className).not.toContain(OPERATIONAL_PRIMARY_CLASS);
    }
    for (const secondary of contextDisclosure.querySelectorAll('[data-tool-secondary]')) {
      expect(secondary.className).not.toContain(OPERATIONAL_SECONDARY_CLASS);
    }
    expectClasses(
      contextDisclosure.querySelector('[data-tool-icon]')!,
      CHAT_OPERATIONAL_LEADING_CLASS,
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
          toolUse: createToolUse(`tool-${name}`, name),
          toolState: 'completed',
          result: 'done',
          workspaceId: 'ws-1',
        },
      });
      const row = container.querySelector('[data-operational-disclosure-row]')!;
      const disclosure = container.querySelector('[data-testid="tool-call-disclosure"]')!;
      const sentence = disclosure.querySelector('[data-tool-sentence]')!;
      const action = container.querySelector(`[data-testid="${testId}"]`)!;
      expectClasses(sentence, CHAT_OPERATIONAL_SUMMARY_CLASS);
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
      { toolUse: createToolUse('tool-path', 'path-tool'), result: 'done' },
      { toolUse: genericTool, result: 'failed', toolState: 'error' as const },
    ];
    for (const props of cases) {
      const view = render(ToolCall, { props: { toolState: 'completed', ...props } });
      const row = view.container.querySelector('[data-operational-disclosure-row]')!;
      expect(row.className).not.toContain('justify-between');
      expect(row.querySelector('.ml-auto')).toBeNull();
      // flex-1 is allowed inside the button's sentence, just not on the row itself or as separate layout spacers
      expect(row.className).not.toContain('flex-1');
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

  describe('expandable disclosure button behavior', () => {
    type DisclosureCase = {
      name: string;
      renderRow: () => HTMLElement;
      accessibleName: RegExp;
      iconSelector: string;
      labelSelector: string;
      detailsSelector: string;
    };

    const disclosureCases: DisclosureCase[] = [
      {
        name: 'ToolCall',
        renderRow: () => {
          const { container } = render(ToolCall, {
            props: { toolUse: genericTool, toolState: 'error', result: 'Command failed' },
          });
          return container.querySelector('[data-operational-disclosure-row]')! as HTMLElement;
        },
        accessibleName: /Run operational task/i,
        iconSelector: '[data-tool-icon]',
        labelSelector: '[data-tool-sentence]',
        detailsSelector: '#tool-details-tool-generic',
      },
      {
        name: 'ContextEngineToolCall',
        renderRow: () => {
          const { container } = render(ContextEngineToolCall, {
            props: { toolUse: contextTool, toolState: 'error', result: 'Search failed' },
          });
          return container.querySelector('[data-operational-disclosure-row]')! as HTMLElement;
        },
        accessibleName: /Technical details/i,
        iconSelector: '[data-tool-icon]',
        labelSelector: '[data-tool-sentence]',
        detailsSelector: '#context-engine-details-tool-context',
      },
      {
        name: 'ThinkingBlock',
        renderRow: () => {
          const { container } = render(ThinkingBlock, {
            props: { content: '# Analyzing requirements\n\nDetailed reasoning' },
          });
          return container.querySelector('[data-operational-disclosure-row]')! as HTMLElement;
        },
        accessibleName: /Analyzing requirements/i,
        iconSelector: '[data-operational-icon-box]',
        labelSelector: '[data-testid="reasoning-summary"]',
        detailsSelector: '[data-operational-expanded-content]',
      },
    ];

    it.each(disclosureCases)(
      'gives $name one named pointer disclosure for its icon and label regions',
      ({ renderRow, accessibleName, iconSelector, labelSelector }) => {
        const row = renderRow();
        const disclosure = within(row).getByRole('button', { name: accessibleName });

        expect(within(row).getAllByRole('button')).toHaveLength(1);
        expect(disclosure.className).toContain('cursor-pointer');
        expect(disclosure.className).toContain('focus-visible:underline');
        expect(disclosure.className).not.toMatch(
          /hover:(?:bg|text|border|opacity)|group-hover:(?:bg|text|border|opacity)/,
        );
        expect(disclosure.getAttribute('aria-label')).toMatch(accessibleName);
        expect(disclosure.getAttribute('aria-expanded')).toBe('false');
        expect(disclosure.querySelector(iconSelector)).toBeTruthy();
        expect(disclosure.querySelector(labelSelector)).toBeTruthy();
      },
    );

    it.each(disclosureCases)(
      'toggles $name exactly once from icon and label clicks',
      async ({ renderRow, accessibleName, iconSelector, labelSelector, detailsSelector }) => {
        const row = renderRow();
        const disclosure = within(row).getByRole('button', { name: accessibleName });
        const iconRegion = disclosure.querySelector(iconSelector)!;
        const labelRegion = disclosure.querySelector(labelSelector)!;

        expect(disclosure.getAttribute('aria-expanded')).toBe('false');
        expect(document.querySelector(detailsSelector)).toBeNull();
        await fireEvent.click(labelRegion);
        expect(disclosure.getAttribute('aria-expanded')).toBe('true');
        expect(document.querySelector(detailsSelector)).toBeTruthy();
        await fireEvent.click(iconRegion);
        expect(disclosure.getAttribute('aria-expanded')).toBe('false');
        expect(document.querySelector(detailsSelector)).toBeNull();
      },
    );

    it.each(disclosureCases)(
      'supports Enter and Space on the $name disclosure',
      async ({ renderRow, accessibleName, detailsSelector }) => {
        const row = renderRow();
        const disclosure = within(row).getByRole('button', { name: accessibleName });

        await fireEvent.keyDown(disclosure, { key: 'Enter' });
        expect(disclosure.getAttribute('aria-expanded')).toBe('true');
        expect(document.querySelector(detailsSelector)).toBeTruthy();
        await fireEvent.keyDown(disclosure, { key: ' ' });
        expect(disclosure.getAttribute('aria-expanded')).toBe('false');
        expect(document.querySelector(detailsSelector)).toBeNull();
      },
    );

    it('keeps an inline file action independent from its ToolCall disclosure', async () => {
      const { container } = render(ToolCall, {
        props: {
          toolUse: createToolUse('tool-file', 'file-tool'),
          toolState: 'completed',
          result: 'done',
          workspaceId: 'ws-1',
        },
      });
      const row = container.querySelector('[data-operational-disclosure-row]')! as HTMLElement;
      const namedControls = within(row).getAllByRole('button', {
        name: /Read src\/QuestionWizard\.svelte/i,
      });
      const disclosure = namedControls.find((control) => control.tagName === 'BUTTON')!;
      const fileAction = namedControls.find((control) => control !== disclosure)!;

      expect(namedControls).toHaveLength(2);
      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
      await fireEvent.click(fileAction);
      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
      await fireEvent.keyDown(fileAction, { key: 'Enter' });
      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
      await fireEvent.keyDown(fileAction, { key: ' ' });
      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    });

    // Running tools WITH input are expandable (input details), so the
    // non-interactive contract only applies to input-less running tools.
    it.each([
      {
        name: 'ToolCall',
        renderRow: () => {
          const { container } = render(ToolCall, {
            props: { toolUse: createToolUse('tool-no-input', 'shell'), toolState: 'running' },
          });
          return container.querySelector('[data-operational-disclosure-row]')! as HTMLElement;
        },
      },
      {
        name: 'ContextEngineToolCall',
        renderRow: () => {
          const { container } = render(ContextEngineToolCall, {
            props: {
              toolUse: createToolUse('tool-context-no-input', 'codebase-retrieval'),
              toolState: 'running',
            },
          });
          return container.querySelector('[data-operational-disclosure-row]')! as HTMLElement;
        },
      },
    ])('keeps non-expandable $name icons animated and non-interactive', ({ renderRow }) => {
      const row = renderRow();
      const icon = row.querySelector('[data-tool-icon]')!;

      expect(within(row).queryByRole('button')).toBeNull();
      expect(icon.tagName).toBe('DIV');
      expect(icon.className).toContain('animate-pulse');
      expect(icon.className).not.toContain('cursor-pointer');
    });
  });
});
