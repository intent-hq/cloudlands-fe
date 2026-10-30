/**
 * @vitest-environment jsdom
 *
 * Chat search and both chat renderers prepare message blocks through the one
 * shared `prepareMessageBlocks` step. Render a message carrying every block the
 * preparation drops or merges, and check that each search match's block path
 * addresses a rendered element that holds the matched text.
 */
import { cleanup } from '@testing-library/svelte';
import { render } from './operational-renderer-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage, ContentBlock } from '$shared/types';
import { findChatSearchMatches } from '../chat-search';
import { warmImport } from '../../../../test/warm-import';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));

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

const WORKSPACE_ID = 'ws-parity';

const card = {
  type: 'resource',
  resource: {
    uri: 'intent-card://generic/1',
    name: 'Generic',
    mimeType: 'application/vnd.intent.other+json',
    text: JSON.stringify({ a: 1 }),
  },
};
const question = {
  type: 'resource',
  resource: { uri: 'intent://question/q-1', mimeType: 'application/vnd.intent.question+json' },
};
const inlineVideo = { type: 'file', data: 'bXA0', mimeType: 'video/mp4', fileName: 'demo.mp4' };
const tool = (id: string, input: Record<string, unknown> = {}) => ({
  type: 'tool_use',
  id,
  toolCallId: `${id}:call`,
  name: 'view',
  input,
});

const content = [
  card,
  { ...card },
  { type: 'text', text: 'alpha needle after duplicate cards' },
  inlineVideo,
  { ...inlineVideo },
  { type: 'text', text: 'bravo needle after duplicate videos' },
  question,
  tool('read-a'),
  { type: 'text', text: '   ' },
  tool('read-b'),
  { type: 'text', text: 'charlie needle after question and empty text' },
  tool('read-c'),
  { type: 'text', text: '<!-- suggested-prompts\nDo the thing.\n-->' },
  tool('read-d'),
  tool('read-c', { path: 'src/c.ts' }),
  { type: 'text', text: 'delta needle after a superseded skeleton' },
  tool('read-e'),
  { type: 'text', content: 'echo needle in a legacy content-only text block' },
] as ContentBlock[];

const message = {
  id: 'parity-message',
  role: 'assistant',
  timestamp: '2026-01-01T00:00:00.000Z',
  contentBlocks: content,
} as AgentMessage;

const renderers = {
  MessageContent: async () =>
    render((await import('../MessageContent.svelte')).default, {
      props: { content, isStreaming: false, role: 'assistant', workspaceId: WORKSPACE_ID },
    }),
  StreamingMessageContent: async () =>
    render((await import('../StreamingMessageContent.svelte')).default, {
      props: { content, isStreaming: false, role: 'assistant', workspaceId: WORKSPACE_ID },
    }),
};

const cases = Object.keys(renderers).flatMap((renderer) =>
  [false, true].map((collapseToolRuns) => ({
    renderer: renderer as keyof typeof renderers,
    collapseToolRuns,
  })),
);

describe('chat search and renderer block path parity', () => {
  it.each(cases)(
    'every match path addresses its text in $renderer (collapseToolRuns: $collapseToolRuns)',
    async ({ renderer, collapseToolRuns }) => {
      storeState.current = {
        theme: { name: 'light' },
        userPreferences: { collapseToolRuns },
      };
      const view = await renderers[renderer]();
      const matches = findChatSearchMatches([message], 'needle', new Map(), null, {
        collapseToolRuns,
        workspaceId: WORKSPACE_ID,
      });

      expect(matches).toHaveLength(5);
      const located = matches.map((match) => {
        const element = view.container.querySelector(
          `[data-chat-search-block-path="${match.blockPath}"]`,
        );
        return element?.textContent?.match(/(\w+) needle/)?.[1] ?? null;
      });
      expect(located).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo']);
    },
  );
});

const CLAUDE_AGENT = 'claude-parity-agent';
const claudeContent = [
  { type: 'thinking', text: 'golf needle in a Claude update' },
  tool('read-f'),
  { type: 'thinking', text: '   ' },
  { type: 'text', text: 'hotel needle after the update' },
  { type: 'thinking', text: '', content: 'india needle in a legacy Claude update' },
] as ContentBlock[];
const claudeMessage = {
  id: 'claude-parity-message',
  role: 'assistant',
  timestamp: '2026-01-01T00:00:00.000Z',
  contentBlocks: claudeContent,
} as AgentMessage;

const claudeRenderers = {
  MessageContent: async () =>
    render((await import('../MessageContent.svelte')).default, {
      props: {
        content: claudeContent,
        isStreaming: false,
        role: 'assistant',
        workspaceId: WORKSPACE_ID,
        agentId: CLAUDE_AGENT,
      },
    }),
  StreamingMessageContent: async () =>
    render((await import('../StreamingMessageContent.svelte')).default, {
      props: {
        content: claudeContent,
        isStreaming: false,
        role: 'assistant',
        workspaceId: WORKSPACE_ID,
        agentId: CLAUDE_AGENT,
      },
    }),
};

describe('chat search and renderer parity for Claude updates shown as text', () => {
  it.each(cases)(
    'search finds each update where $renderer shows it (collapseToolRuns: $collapseToolRuns)',
    async ({ renderer, collapseToolRuns }) => {
      storeState.current = {
        theme: { name: 'light' },
        userPreferences: { collapseToolRuns },
        agentSessions: {
          byAgentId: { [CLAUDE_AGENT]: { id: CLAUDE_AGENT, provider: 'claude-code' } },
        },
      };
      const view = await claudeRenderers[renderer]();
      const matches = findChatSearchMatches([claudeMessage], 'needle', new Map(), null, {
        collapseToolRuns,
        workspaceId: WORKSPACE_ID,
        reasoningAsText: true,
      });

      expect(matches.map((match) => match.disclosurePath)).toEqual([[], [], []]);
      const located = matches.map((match) => {
        const element = view.container.querySelector(
          `[data-chat-search-block-path="${match.blockPath}"]`,
        );
        return element?.textContent?.match(/(\w+) needle/)?.[1] ?? null;
      });
      expect(located).toEqual(['golf', 'hotel', 'india']);
    },
  );
});
