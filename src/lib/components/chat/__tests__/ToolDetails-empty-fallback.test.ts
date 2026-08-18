/**
 * @vitest-environment jsdom
 *
 * ToolDetails must never expand to an empty container: when parsedResult is
 * rich-typed (e.g. 'confirmation') but has no renderable content, it must fall
 * fall back to sanitized input/output behind an explicit technical-details
 * disclosure, without adding a redundant completion state.
 */
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
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

vi.mock('$features/agent/components/auggie-avatar/AuggieAvatar.svelte', async () => ({
  default: (await import('./mocks/AuggieAvatar.svelte')).default,
}));

import ToolDetails from '../ToolDetails.svelte';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ToolDetails empty rich-result fallback', () => {
  it('keeps fallback input and output behind a collapsed technical-details disclosure', async () => {
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

    expect(container.textContent).not.toContain('Completed');
    expect(container.textContent).not.toContain('Raw');
    const disclosure = container.querySelector('details');
    const summary = container.querySelector('summary');
    expect(disclosure?.open).toBe(false);
    expect(summary?.textContent?.trim()).toBe('Technical details');

    await fireEvent.click(summary!);
    expect(disclosure?.open).toBe(true);
    expect(disclosure?.textContent).toContain('Ask the user a clarifying question');
    expect(disclosure?.textContent).toContain('Question queued');
  });

  it('shows input details without a redundant completion label', () => {
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
    expect(container.textContent).toContain('Technical details');
    expect(container.textContent).not.toContain('Completed');
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

    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).not.toContain('Completed');
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

describe('ToolDetails pending (running) rendering', () => {
  it('shows the full multiline command for a pending terminal call without a result section', () => {
    const command = 'cd packages/cloudlands-fe && \\\n  pnpm vitest run \\\n  src/lib/tests';
    const { container } = render(ToolDetails, {
      props: {
        input: { command },
        result: undefined,
        parsedResult: null,
        isError: false,
        pending: true,
      },
    });

    const pre = container.querySelector('pre');
    expect(pre?.textContent).toBe(command);
    expect(container.textContent).not.toContain('Result');
    expect(container.textContent).not.toContain('No output');
  });

  it('shows sanitized JSON input for a pending non-terminal call without a result section', () => {
    const { container } = render(ToolDetails, {
      props: {
        input: { path: '/repo/src/file.ts', view_range: [1, 120] },
        result: undefined,
        parsedResult: null,
        isError: false,
        pending: true,
      },
    });

    expect(container.textContent).toContain('Input');
    expect(container.textContent).toContain('/repo/src/file.ts');
    expect(container.textContent).not.toContain('Result');
  });

  it('redacts secrets in a pending command while preserving line structure', () => {
    const { container } = render(ToolDetails, {
      props: {
        input: { command: 'export API_KEY=abc123 && \\\n  ./deploy.sh' },
        result: undefined,
        parsedResult: null,
        isError: false,
        pending: true,
      },
    });

    const pre = container.querySelector('pre');
    expect(pre?.textContent).toContain('API_KEY=[redacted]');
    expect(pre?.textContent).toContain('\n  ./deploy.sh');
    expect(pre?.textContent).not.toContain('abc123');
  });
});

describe('ToolDetails batch delegate rendering', () => {
  it('renders a disposition summary instead of the "Agent spawned" label', () => {
    const { container } = render(ToolDetails, {
      props: {
        input: {
          code: 'return await ws.agent.delegate({ tasks: ["n-1", "n-2", "n-3"] })',
          summary: 'Delegate batch',
        },
        result: '{"ok":true,"tasks":[]}',
        parsedResult: {
          type: 'delegate-task' as const,
          delegateBatch: {
            started: 2,
            held: 1,
            skipped: 1,
            errors: 0,
            startedRows: [
              { agentId: 'agent-1', agentName: 'Implementor #1' },
              { agentId: 'agent-2', agentName: 'Implementor #2' },
            ],
          },
        },
        isError: false,
      },
    });

    expect(container.textContent).toContain('2 started');
    expect(container.textContent).toContain('1 held');
    expect(container.textContent).toContain('1 skipped');
    expect(container.textContent).not.toContain('failed');
    expect(container.textContent).not.toContain('Agent spawned');
  });

  it('keeps the single-agent fallback label when no agent id was parsed', () => {
    const { container } = render(ToolDetails, {
      props: {
        input: {
          code: 'return await ws.agent.delegate({ taskNoteId: "n-1" })',
          summary: 'Delegate task',
        },
        result: 'ok',
        parsedResult: { type: 'delegate-task' as const, content: 'ok' },
        isError: false,
      },
    });

    expect(container.textContent).toContain('Agent spawned');
  });
});
