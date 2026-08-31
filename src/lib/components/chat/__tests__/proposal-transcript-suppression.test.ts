/**
 * @vitest-environment jsdom
 */
/**
 * Proposals are tray-only (PROTOCOL §5.5 — the composer-slot ProposalTray is
 * the sole rendering surface, question-wizard model): the transcript
 * renderers strip proposal blocks entirely, in every state (pending,
 * resolved, or unknown to the metadata). This is what kills the tray/
 * transcript flicker by construction — there is no transcript paint path to
 * race. Covers the normal-workspace path (where the flicker reproduced) and
 * the Chief sidebar path.
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

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: vi.fn() });
});

afterEach(cleanup);

warmImport(() => import('../MessageContent.svelte'));
warmImport(() => import('../StreamingMessageContent.svelte'));

const proposal: Proposal = {
  kind: 'workspace-create',
  applyToolCallId: 'toolu-prop-1',
  payload: { params: { title: 'Fix flaky CI job' } },
  preview: {
    title: 'Fix flaky CI job',
    workspaceCreate: { mode: 'sibling', title: 'Fix flaky CI job' },
  },
} as Proposal;

/** Daemon-canonical §7.1 lifted proposal resource block. */
const resourceBlock: ContentBlock = {
  type: 'resource',
  resource: createProposalResource(proposal),
} as unknown as ContentBlock;

/** Legacy inline proposal-carrying block shape. */
const inlineBlock: ContentBlock = {
  type: 'proposal',
  proposal,
} as unknown as ContentBlock;

const content: ContentBlock[] = [
  { type: 'text', text: 'Here is a proposal for you.' },
  resourceBlock,
  inlineBlock,
];

function expectNoProposalCard(container: HTMLElement) {
  expect(container.querySelector('[data-proposal-kind]')).toBeNull();
  expect(document.body.textContent).toContain('Here is a proposal for you.');
  expect(document.body.textContent).not.toContain('Fix flaky CI job');
}

describe.each([
  ['a normal workspace', 'workspace-1'],
  ['the Chief workspace', CHIEF_WORKSPACE_ID as string],
])('proposal transcript suppression in %s', (_name, workspaceId) => {
  it('never renders proposal blocks in the static transcript', async () => {
    const MessageContent = (await import('../MessageContent.svelte')).default;
    const { container } = render(MessageContent, {
      props: { content, workspaceId, agentId: 'agent-1', messageId: 'm1' },
    });
    expectNoProposalCard(container);
  });

  it('never renders proposal blocks while streaming (no flicker paint path)', async () => {
    const StreamingMessageContent = (await import('../StreamingMessageContent.svelte')).default;
    const { container } = render(StreamingMessageContent, {
      props: { content, isStreaming: true, workspaceId, agentId: 'agent-1', messageId: 'm1' },
    });
    expectNoProposalCard(container);
  });

  it('keeps proposal blocks stripped after the turn completes', async () => {
    const StreamingMessageContent = (await import('../StreamingMessageContent.svelte')).default;
    const { container, rerender } = render(StreamingMessageContent, {
      props: { content, isStreaming: true, workspaceId, agentId: 'agent-1', messageId: 'm1' },
    });
    await rerender({ content, isStreaming: false });
    expectNoProposalCard(container);
  });
});
