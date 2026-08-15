/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/svelte';
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

import MixedToolRowsHarness from './mocks/MixedToolRowsHarness.svelte';

afterEach(cleanup);

describe('screenshot-shaped mixed compact tool sequence', () => {
  it('renders every collapsed tool as one aligned sentence without secondary columns', () => {
    const { container } = render(MixedToolRowsHarness);
    const rows = [...container.querySelectorAll('[data-compact-tool-row]')];
    expect(rows).toHaveLength(11);

    const stableClasses = (element: Element) =>
      element.className
        .split(' ')
        .filter((name) => name && !name.startsWith('svelte-'))
        .join(' ');
    const rowClasses = new Set(rows.map(stableClasses));
    expect(rowClasses.size).toBe(1);
    for (const row of rows) {
      expect(row.className).toContain('grid-cols-[1rem_minmax(0,1fr)_auto]');
      expect(row.className).toContain('min-h-5');
      expect(row.querySelectorAll('[data-tool-icon]')).toHaveLength(1);
      expect(row.querySelectorAll('[data-tool-sentence]')).toHaveLength(1);
      expect(row.querySelectorAll('[data-testid="tool-call-path"]')).toHaveLength(0);
      const sentence = row.querySelector('[data-tool-sentence]')!;
      const inlineFile = row.querySelector('[data-testid="tool-call-file-link"]');
      expect(row.querySelectorAll('.truncate')).toHaveLength(inlineFile ? 2 : 1);
      if (inlineFile) expect(sentence.contains(inlineFile)).toBe(true);
      expect(row.textContent).not.toMatch(/·|\s\|\s/);
    }

    const sentences = [...container.querySelectorAll('[data-tool-sentence]')];
    for (const sentence of sentences) {
      expect(stableClasses(sentence)).toContain(
        'block min-w-0 max-w-full truncate whitespace-nowrap',
      );
    }
    expect(container.textContent).toContain('Read tool-classifier.ts lines 1–120');
    expect(container.textContent).toContain('Search en.json in repository/messages');
    expect(container.textContent).toContain('Search codebase for compact tool-call rendering');
    expect(container.textContent).toContain('Thinking');
  });

  it('keeps complete accessible provenance and semantic trailing states', () => {
    const { container } = render(MixedToolRowsHarness);
    const read = screen.getAllByTestId('tool-call-summary')[0];
    expect(read.getAttribute('aria-label')).toContain(
      '/Users/example/repository/src/lib/components/chat/tool-classifier.ts',
    );

    const successRows = container.querySelectorAll('[data-tool-status="success"]');
    expect(successRows).toHaveLength(2);
    expect(successRows[0].textContent).toBe('Success');
    expect(container.querySelector('[data-tool-status="error"]')?.textContent).toBe('Failed');

    const sequence = screen.getByTestId('mixed-tool-sequence');
    sequence.setAttribute('style', 'width: 120px; max-width: 120px; overflow: hidden');
    expect(sequence.scrollWidth).toBeLessThanOrEqual(sequence.clientWidth);
  });

  it('renders ok-only workspace mutations without Completed, Raw, or an expandable body', () => {
    const { container } = render(MixedToolRowsHarness);
    const sessionRow = container
      .querySelector('[data-tool-use-id="session-name"]')
      ?.closest('[data-conversation-layer="tool-activity"]');
    const completionRow = container
      .querySelector('[data-tool-use-id="complete"]')
      ?.closest('[data-conversation-layer="tool-activity"]');
    for (const row of [sessionRow, completionRow]) {
      expect(row).toBeTruthy();
      expect(row?.querySelector('[aria-expanded]')).toBeNull();
      expect(row?.textContent).not.toContain('Completed');
      expect(row?.textContent).not.toContain('Raw');
      expect(row?.querySelector('[data-tool-status="success"]')).toBeTruthy();
    }
  });
});
