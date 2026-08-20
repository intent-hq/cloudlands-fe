/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolUseBlock } from '$shared/types';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: vi.fn() });
});

vi.mock('$lib/utils/tool-classifier', async () => {
  const { faWrench } = await import('@fortawesome/free-solid-svg-icons');
  return {
    classifyTool: (name: string) => ({
      category:
        name === 'read_note'
          ? 'note'
          : name.includes('set_workspace_title')
            ? 'workspace'
            : 'terminal',
      verb:
        name === 'read_note'
          ? 'Read note'
          : name.includes('set_workspace_title')
            ? 'Rename workspace'
            : 'Run',
      subject: 'an exceptionally long tool summary '.repeat(10),
      noteId: name === 'read_note' ? 'spec' : null,
      icon: faWrench,
    }),
    isContextEngineTool: () => false,
  };
});

vi.mock('../tool-result-parser', () => ({
  parseToolResult: (name: string, _input: unknown, result: unknown) =>
    name === 'codebase-retrieval'
      ? { type: 'unknown', content: typeof result === 'string' ? result : '' }
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

import ContextEngineToolCall from '../ContextEngineToolCall.svelte';
import ToolCall from '../ToolCall.svelte';

const genericTool = {
  type: 'tool_use',
  id: 'generic-running',
  name: 'launch-process',
  input: { command: 'pnpm test' },
} as ToolUseBlock;
const contextTool = {
  type: 'tool_use',
  id: 'context-running',
  name: 'codebase-retrieval',
  input: { information_request: 'Find every active tool row' },
} as ToolUseBlock;

afterEach(cleanup);

function expectRunningIdentityOnly(container: HTMLElement) {
  const leading = container.querySelector('[data-tool-icon]');
  expect(leading).toBeTruthy();
  expect(leading?.className).toContain('animate-pulse');
  expect(container.querySelector('[data-operational-trailing]')).toBeNull();
  expect(container.querySelector('[data-testid="tool-call-status"]')).toBeNull();
  expect(container.querySelector('[data-icon="spinner"]')).toBeNull();
}

describe('tool-call running status presentation', () => {
  it('uses only the leading pulse for generic and context-engine running rows', () => {
    const generic = render(ToolCall, { props: { toolUse: genericTool, toolState: 'running' } });
    expectRunningIdentityOnly(generic.container);
    cleanup();

    const context = render(ContextEngineToolCall, {
      props: { toolUse: contextTool, toolState: 'running' },
    });
    expectRunningIdentityOnly(context.container);
  });

  it('preserves generic and context-engine success and error status icons', () => {
    const successTool = {
      ...genericTool,
      id: 'generic-success',
      name: 'set_workspace_title_workspace-mcp',
    };
    render(ToolCall, {
      props: { toolUse: successTool, toolState: 'completed', result: { ok: true } },
    });
    expect(screen.getByTestId('tool-call-status').dataset.toolStatus).toBe('success');
    cleanup();

    render(ToolCall, {
      props: { toolUse: genericTool, toolState: 'error', result: 'failed' },
    });
    expect(screen.getByTestId('tool-call-status').dataset.toolStatus).toBe('error');
    cleanup();

    render(ContextEngineToolCall, { props: { toolUse: contextTool, toolState: 'completed' } });
    expect(screen.getByTestId('tool-call-status').dataset.toolStatus).toBe('success');
    cleanup();

    render(ContextEngineToolCall, {
      props: { toolUse: contextTool, toolState: 'error', result: 'failed' },
    });
    expect(screen.getByTestId('tool-call-status').dataset.toolStatus).toBe('error');
  });

  it('preserves real trailing actions and keyboard disclosure behavior', async () => {
    const noteTool = { ...genericTool, id: 'note-action', name: 'read_note' };
    const note = render(ToolCall, { props: { toolUse: noteTool, toolState: 'completed' } });
    expect(screen.getByTestId('tool-call-note-link')).toBeTruthy();
    expect(note.container.querySelector('[data-operational-trailing]')).toBeTruthy();
    cleanup();

    render(ToolCall, { props: { toolUse: genericTool, toolState: 'running' } });
    const disclosure = screen.getByTestId('tool-call-disclosure');
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.keyDown(disclosure, { key: 'Enter' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('#tool-details-generic-running')).toBeTruthy();
  });
});
