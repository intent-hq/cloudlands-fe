/**
 * @vitest-environment jsdom
 */
/**
 * Proposal blocks render inline at their transcript position regardless of
 * lifecycle state. Covers both §7.1 resource blocks and legacy inline blocks
 * in normal workspaces and the Chief sidebar path.
 */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentBlock } from '$shared/types';
import type { Proposal } from '$shared/types/proposal';
import { createProposalResource } from '$shared/types/proposal-resource';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { warmImport } from '../../../../test/warm-import';

vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$lib/components/markdown/MarkdownViewer.svelte', async () => ({
  default: (await import('./mocks/MarkdownViewerStub.svelte')).default,
}));

vi.mock('../proposals/InlineProposal.svelte', async () => ({
  default: (await import('./mocks/MockInlineAgentAvatar.svelte')).default,
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: vi.fn() });
});

afterEach(cleanup);

warmImport(() => import('../MessageContent.svelte'));
warmImport(() => import('../StreamingMessageContent.svelte'));

const lifecycleStates = ['pending', 'resolved', 'metadata-unknown'] as const;

function makeProposal(id: string): Proposal {
  return {
    kind: 'workspace-create',
    applyToolCallId: id,
    payload: { params: { title: `Proposal ${id}` } },
    preview: {
      title: `Proposal ${id}`,
      workspaceCreate: { mode: 'sibling', title: `Proposal ${id}` },
    },
  } as Proposal;
}

const content: ContentBlock[] = [
  { type: 'text', text: 'Here are proposals for you.' },
  ...lifecycleStates.flatMap((state) => {
    const resourceProposal = makeProposal(`resource-${state}`);
    const inlineProposal = makeProposal(`inline-${state}`);
    return [
      {
        type: 'resource',
        resource: createProposalResource(resourceProposal),
      } as unknown as ContentBlock,
      { type: 'proposal', proposal: inlineProposal } as unknown as ContentBlock,
    ];
  }),
];

function expectInlineProposalCards(container: HTMLElement) {
  const cards = container.querySelectorAll('[data-testid="event-agent-avatar"]');
  const prose = Array.from(container.querySelectorAll('*')).find(
    (element) => element.textContent === 'Here are proposals for you.',
  );
  expect(cards).toHaveLength(lifecycleStates.length * 2);
  expect(prose).toBeTruthy();
  expect(prose!.compareDocumentPosition(cards[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

describe.each([
  ['a normal workspace', 'workspace-1'],
  ['the Chief workspace', CHIEF_WORKSPACE_ID as string],
])('inline proposal transcript rendering in %s', (_name, workspaceId) => {
  it('renders every proposal block in the static transcript', async () => {
    const MessageContent = (await import('../MessageContent.svelte')).default;
    const { container } = render(MessageContent, {
      props: { content, workspaceId, agentId: 'agent-1', messageId: 'm1' },
    });
    expectInlineProposalCards(container);
  });

  it('renders every proposal block while streaming', async () => {
    const StreamingMessageContent = (await import('../StreamingMessageContent.svelte')).default;
    const { container } = render(StreamingMessageContent, {
      props: { content, isStreaming: true, workspaceId, agentId: 'agent-1', messageId: 'm1' },
    });
    expectInlineProposalCards(container);
  });

  it('keeps every proposal block inline after the turn completes', async () => {
    const StreamingMessageContent = (await import('../StreamingMessageContent.svelte')).default;
    const { container, rerender } = render(StreamingMessageContent, {
      props: { content, isStreaming: true, workspaceId, agentId: 'agent-1', messageId: 'm1' },
    });
    await rerender({ content, isStreaming: false });
    expectInlineProposalCards(container);
  });
});
