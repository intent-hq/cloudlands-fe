/**
 * @vitest-environment jsdom
 *
 * ToolDetails must show the actual error text when a tool call fails
 * (isError=true) and a result payload exists — even when parsedResult is
 * null/unknown — and only fall back to "No error details available" when
 * there is truly no result payload.
 */
import { render, cleanup } from '@testing-library/svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({ state: () => ({}), dispatch: vi.fn() });
});

vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

vi.mock('$lib/components/ui/diff', async () => ({
  DiffViewer: (await import('./mocks/SlotOnly.svelte')).default,
}));

vi.mock('$lib/components/editor/MarkdownRenderer.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

vi.mock('$lib/components/editor/CodeBlock.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

vi.mock('../AgentCard.svelte', async () => ({
  default: (await import('./mocks/SlotOnly.svelte')).default,
}));

vi.mock('$lib/components/ui/auggie-avatar/AuggieAvatar.svelte', async () => ({
  default: (await import('./mocks/AuggieAvatar.svelte')).default,
}));

import ToolDetails from '../ToolDetails.svelte';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ToolDetails error display', () => {
  it('renders the nested output string from an object error result', () => {
    const { container } = render(ToolDetails, {
      props: {
        input: {},
        result: { output: 'Tool workspace_api_workspace-mcp not found.' },
        parsedResult: null,
        isError: true,
      },
    });

    expect(container.textContent).toContain(
      'Tool workspace_api_workspace-mcp not found.',
    );
    // The nested string is extracted, not shown as a JSON blob
    expect(container.textContent).not.toContain('"output"');
    expect(container.textContent).not.toContain('No error details available');
  });

  it('renders a plain string error result as-is', () => {
    const { container } = render(ToolDetails, {
      props: {
        input: {},
        result: 'Connection refused',
        parsedResult: null,
        isError: true,
      },
    });

    expect(container.textContent).toContain('Connection refused');
    expect(container.textContent).not.toContain('No error details available');
  });

  it('renders object results without an output string as pretty-printed JSON', () => {
    const { container } = render(ToolDetails, {
      props: {
        input: {},
        result: { code: -32601, message: 'Method not found' },
        parsedResult: null,
        isError: true,
      },
    });

    expect(container.textContent).toContain('"message": "Method not found"');
    expect(container.textContent).not.toContain('No error details available');
  });

  it('shows the fallback when there is truly no result payload', () => {
    const { container } = render(ToolDetails, {
      props: {
        input: {},
        result: undefined,
        parsedResult: null,
        isError: true,
      },
    });

    expect(container.textContent).toContain('No error details available');
  });

  it('shows input entries plus the fallback when there is no result but inputs exist', () => {
    const { container } = render(ToolDetails, {
      props: {
        input: { command: 'ls -la' },
        result: undefined,
        parsedResult: null,
        isError: true,
      },
    });

    expect(container.textContent).toContain('command');
    expect(container.textContent).toContain('ls -la');
    expect(container.textContent).toContain('No error details available');
  });

  it('does not change non-error rendering with a result payload', () => {
    const { container } = render(ToolDetails, {
      props: {
        input: {},
        result: 'plain output',
        parsedResult: null,
        isError: false,
      },
    });

    expect(container.textContent).toContain('plain output');
    expect(container.textContent).not.toContain('No error details available');
  });
});
