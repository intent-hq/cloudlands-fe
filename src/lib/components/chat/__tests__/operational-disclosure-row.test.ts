/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spring } from '$lib/motion';
import type { ToolUseBlock } from '$shared/types';

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
      if (name === 'file-tool') {
        return {
          verb: 'Read',
          subject: 'QuestionWizard.svelte',
          filePath: 'src/QuestionWizard.svelte',
          path: 'src/lib/components/chat/questions',
          icon: faWrench,
        };
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
import ResponseGroup from '../ResponseGroup.svelte';
import ThinkingBlock from '../ThinkingBlock.svelte';
import ToolCall from '../ToolCall.svelte';
import { safeOperationalDetailsTransition } from '../operational-disclosure-row';

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
const children = createRawSnippet(() => ({ render: () => '<div>Expanded group content</div>' }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('shared operational disclosure-row contract', () => {
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
    expect(safeOperationalDetailsTransition(document.createElement('div')).duration).toBe(
      spring.moderate.settleMs,
    );
  });

  it('selects leading icons for tool and reasoning types', () => {
    const expectLeadingIcon = (container: HTMLElement, name: string) => {
      const icon = container.querySelector('[data-operational-leading] [data-icon]')!;
      expect(icon.getAttribute('data-icon')).toBe(name);
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
    expect(toolIcon.hasAttribute('data-streaming-pulse')).toBe(true);
    cleanup();

    render(ContextEngineToolCall, { props: { toolUse: contextTool, toolState: 'running' } });
    const searchIcon = screen
      .getByTestId('context-engine-tool-call')
      .querySelector('[data-tool-icon]')!;
    expect(searchIcon.hasAttribute('data-streaming-pulse')).toBe(true);
    expect(screen.queryByTestId('tool-call-status')).toBeNull();
    expect(document.querySelector('[data-operational-trailing]')).toBeNull();
    cleanup();

    render(ThinkingBlock, { props: { content: 'Thinking', isStreaming: true } });
    const reasoning = screen.getByTestId('reasoning-tool-call');
    expect(within(reasoning).getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(reasoning.querySelector('[data-icon="brain"]')).toBeNull();
    expect(
      reasoning.querySelector('[data-operational-leading]')!.hasAttribute('data-streaming-pulse'),
    ).toBe(true);
    cleanup();

    const group = render(ResponseGroup, {
      props: { name: 'Streaming group', isStreaming: true, children },
    });
    const groupIconBox = group.container.querySelector('[data-operational-icon-box]')!;
    expect(groupIconBox.querySelector('[data-icon="arrows-out-line-vertical"]')).toBeTruthy();
    expect(group.container.querySelector('[data-operational-chevron]')).toBeNull();
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
      expect(icon.hasAttribute('data-streaming-pulse')).toBe(true);
    });
  });
});
