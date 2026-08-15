/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: vi.fn() });
});

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspaceId: { select: () => 'ws-1' },
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: { select: () => undefined },
}));

vi.mock('../tool-classifier', async () => {
  const { faWrench } = await import('@fortawesome/free-solid-svg-icons');
  return {
    classifyTool: () => ({
      verb: 'Run',
      subject: 'tests with an exceptionally long descriptive target '.repeat(8),
      icon: faWrench,
    }),
    isContextEngineTool: () => false,
  };
});

vi.mock('../tool-result-parser', () => ({
  parseToolResult: () => ({ type: 'unknown' }),
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

vi.mock('../ToolDetails.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

vi.mock('$lib/components/settings/mcp/McpIcon.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

vi.mock('$features/agent/components/auggie-avatar/AuggieAvatar.svelte', async () => ({
  default: (await import('./mocks/AuggieAvatar.svelte')).default,
}));

import ToolCall from '../ToolCall.svelte';

afterEach(cleanup);

describe('ToolCall conversation legibility', () => {
  it('renders a concise action with an accessible collapsed details disclosure', async () => {
    const { container } = render(ToolCall, {
      props: {
        toolUse: { id: 'tool-1', name: 'shell', input: { command: 'pnpm test' } } as any,
        toolState: 'completed',
        result: { stdout: 'passed' },
      },
    });

    const disclosure = screen.getByRole('button', {
      name: /Run tests with an exceptionally long descriptive target/,
    });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(disclosure.getAttribute('aria-controls')).toBe('tool-details-tool-1');
    expect(disclosure.getAttribute('title')).toBe('Technical details');
    expect(container.textContent).not.toContain('Details');
    expect(container.querySelector('#tool-details-tool-1')).toBeNull();

    container.style.width = '120px';
    const row = container.querySelector('[data-conversation-layer="tool-activity"]')!;
    const summary = screen.getByTestId('tool-call-summary');
    expect(row.scrollWidth).toBeLessThanOrEqual(container.scrollWidth);
    expect(row.className).toContain('min-w-0');
    expect(row.className).toContain('overflow-hidden');
    expect(summary.className).toContain('truncate');
    disclosure.focus();
    expect(document.activeElement).toBe(disclosure);

    await fireEvent.keyDown(disclosure, { key: 'Enter' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('#tool-details-tool-1')).toBeTruthy();
    expect(container.querySelector('[data-conversation-layer="tool-activity"]')).toBeTruthy();
  });
});
