/**
 * @vitest-environment jsdom
 *
 * ToolDetails must never expand to an empty container: when parsedResult is
 * rich-typed (e.g. 'confirmation') but has no renderable content, it must fall
 * back to the input details + raw result view (or "Completed" when there is
 * no result payload at all).
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

describe('ToolDetails empty rich-result fallback', () => {
  it('falls back to input details + raw result when confirmation has no content', () => {
    const { container } = render(ToolDetails, {
      props: {
        input: {
          code: 'await ws.app.question.ask({ question: "Pick one" })',
          summary: 'Ask the user a clarifying question',
        },
        result: { ok: true, attachmentId: 'att-1', message: 'Question queued' },
        parsedResult: { type: 'confirmation' as const, content: undefined },
        isError: false,
      },
    });

    // Input details are visible
    expect(container.textContent).toContain('summary');
    expect(container.textContent).toContain('Ask the user a clarifying question');
    // Raw result payload is visible
    expect(container.textContent).toContain('Question queued');
  });

  it('shows input details and "Completed" when confirmation has no content and no result', () => {
    const { container } = render(ToolDetails, {
      props: {
        input: {
          code: 'await ws.app.question.ask({ question: "Pick one" })',
          summary: 'Ask the user',
        },
        result: undefined,
        parsedResult: { type: 'confirmation' as const, content: undefined },
        isError: false,
      },
    });

    expect(container.textContent).toContain('Ask the user');
    expect(container.textContent).toContain('Completed');
  });

  it('never renders an empty details container for a rich-typed parsedResult', () => {
    const { container } = render(ToolDetails, {
      props: {
        input: {},
        result: undefined,
        parsedResult: { type: 'confirmation' as const, content: undefined },
        isError: false,
      },
    });

    expect(container.textContent).toContain('Completed');
  });

  it('falls back to input details + raw result for a bare browser parsedResult', () => {
    // parseBrowserResult returns { type: 'browser' } with no renderable fields
    // when the result is falsy or its text is unextractable (e.g. object payload)
    const { container } = render(ToolDetails, {
      props: {
        input: { code: 'await ws.browser.exec([{ action: "navigate" }])', summary: 'Navigate' },
        result: { ok: true, detail: 'persisted object payload' },
        parsedResult: { type: 'browser' as const },
        isError: false,
      },
    });

    expect(container.textContent).toContain('Navigate');
    expect(container.textContent).toContain('persisted object payload');
  });

  it('falls back to input details + raw result for a bare figma parsedResult', () => {
    // parseFigmaResult returns { type: 'figma' } when the result carries no
    // images and no extractable text
    const { container } = render(ToolDetails, {
      props: {
        input: { nodeId: '1:23' },
        result: { nodes: 3 },
        parsedResult: { type: 'figma' as const },
        isError: false,
      },
    });

    expect(container.textContent).toContain('1:23');
    expect(container.textContent).toContain('"nodes": 3');
  });

  it('still renders confirmation content directly when present', () => {
    const { container } = render(ToolDetails, {
      props: {
        input: { code: 'await ws.app.question.ask({})', summary: 'Ask' },
        result: 'Question queued for the user',
        parsedResult: {
          type: 'confirmation' as const,
          content: 'Question queued for the user',
        },
        isError: false,
      },
    });

    expect(container.textContent).toContain('Question queued for the user');
  });
});
