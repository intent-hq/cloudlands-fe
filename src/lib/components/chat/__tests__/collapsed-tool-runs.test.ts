/**
 * @vitest-environment jsdom
 *
 * With the "Collapse tool activity" preference on, both chat renderers show a
 * run of consecutive tool calls and thinking steps as one expandable summary
 * row, keep prose between runs visible, and leave single rows untouched.
 */
import { cleanup, screen } from '@testing-library/svelte';
import { fireEvent, render } from './operational-renderer-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentBlock } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import { warmImport } from '../../../../test/warm-import';

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

warmImport(() => import('../StreamingMessageContent.svelte'));
warmImport(() => import('../MessageContent.svelte'));

function setCollapse(enabled: boolean) {
  storeState.current = {
    theme: { name: 'light' },
    userPreferences: { collapseToolRuns: enabled },
  };
}

function tool(id: string, path: string): ContentBlock[] {
  return [
    { type: 'tool_use', id, toolCallId: `${id}:call`, name: 'view', input: { path } },
    { type: 'tool_result', id: `${id}:result`, tool_use_id: `${id}:call`, output: 'ok' },
  ] as ContentBlock[];
}

const transcript: ContentBlock[] = [
  { type: 'text', id: 'intro', text: 'Setup finished.' },
  ...tool('read-a', 'src/a.ts'),
  { type: 'thinking', id: 'think-1', text: '**Comparing approaches**' },
  ...tool('read-b', 'src/b.ts'),
  { type: 'text', id: 'middle', text: 'The approach looks feasible.' },
  ...tool('read-c', 'src/c.ts'),
  { type: 'text', id: 'outro', text: 'Done.' },
];

const renderers = {
  MessageContent: async (content: ContentBlock[]) =>
    render((await import('../MessageContent.svelte')).default, {
      props: { content, isStreaming: false },
    }),
  StreamingMessageContent: async (content: ContentBlock[]) =>
    render((await import('../StreamingMessageContent.svelte')).default, {
      props: { content, isStreaming: false },
    }),
};

const toolRows = (container: HTMLElement) =>
  container.querySelectorAll('[data-chat-operational-row][data-tool-use-id]');
const proseOrder = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-message-content-block="text"]')].map((node) =>
    node.textContent?.trim(),
  );

describe('collapsed tool runs', () => {
  for (const [name, renderMessage] of Object.entries(renderers)) {
    it(`collapses a multi-step run into one expandable row in ${name}`, async () => {
      setCollapse(true);
      const view = await renderMessage(transcript);

      const groups = screen.getAllByTestId('response-group');
      expect(groups).toHaveLength(1);
      const expectedLabel = m.chat_responseGroup_collapsedRunSummary_label({
        tools: m.chat_responseGroup_collapsedRunTools_many({ count: '2' }),
        thinking: m.chat_responseGroup_collapsedRunThinking_one(),
      });
      expect(screen.getByTestId('response-group-name').textContent?.trim()).toBe(expectedLabel);

      // Only the lone trailing tool stays a visible top-level row while collapsed.
      expect(
        [...toolRows(view.container)].map((row) => row.getAttribute('data-tool-use-id')),
      ).toEqual(['read-c']);
      expect(proseOrder(view.container)).toEqual([
        'Setup finished.',
        'The approach looks feasible.',
        'Done.',
      ]);

      const disclosure = screen.getByTestId('response-group-disclosure');
      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
      await fireEvent.click(disclosure);
      expect(disclosure.getAttribute('aria-expanded')).toBe('true');
      expect(
        [...toolRows(view.container)].map((row) => row.getAttribute('data-tool-use-id')),
      ).toEqual(['read-a', 'read-b', 'read-c']);

      await fireEvent.click(disclosure);
      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    });

    it(`renders every row as before when the preference is off in ${name}`, async () => {
      setCollapse(false);
      const view = await renderMessage(transcript);

      expect(screen.queryAllByTestId('response-group')).toHaveLength(0);
      expect(
        [...toolRows(view.container)].map((row) => row.getAttribute('data-tool-use-id')),
      ).toEqual(['read-a', 'read-b', 'read-c']);
    });
  }
});
