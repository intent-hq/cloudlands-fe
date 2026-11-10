import type { Locator } from '@playwright/experimental-ct-svelte';
import type { AgentMessage, ContentBlock, PendingProposalRef } from '$shared/types';
import type { WorkspaceCreateProposal } from '$shared/types/proposal';
import { createProposalResource } from '$shared/types/proposal-resource';
import { expect, test } from '../../../../test/ct-test';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';

test.setTimeout(120_000);

// Legacy (pre applyToolCallId) workspace-create cards are keyed by their
// title, so a re-proposal shares the key of an earlier, already-applied card.
function legacyCard(initialPrompt: string): ContentBlock {
  const proposal: WorkspaceCreateProposal = {
    kind: 'workspace-create',
    payload: {
      operation: 'workspace.create',
      params: { title: 'Create workspace', initialPrompt },
    },
    preview: {
      title: 'Create workspace',
      workspaceCreate: { mode: 'sibling', title: 'Create workspace', initialPrompt },
    },
  };
  return {
    type: 'resource',
    resource: createProposalResource(proposal),
  } as unknown as ContentBlock;
}

const messages: AgentMessage[] = [
  ...Array.from({ length: 40 }, (_, index) => ({
    id: `history-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    timestamp: '2026-09-23T12:00:00.000Z',
    contentBlocks:
      index === 1
        ? [legacyCard('First proposal.')]
        : index === 3
          ? [legacyCard('Re-proposal with the same title.')]
          : [
              {
                type: 'text',
                text: `Historical message ${index}. ${'Earlier context. '.repeat(24)}`,
              },
            ],
  })),
  {
    id: 'live-prompt',
    role: 'user',
    timestamp: '2026-09-23T12:01:00.000Z',
    contentBlocks: [{ type: 'text', text: 'Anything else?' }],
  },
  {
    id: 'live-response',
    role: 'assistant',
    timestamp: '2026-09-23T12:01:01.000Z',
    isStreaming: true,
    streamingComplete: false,
    contentBlocks: [{ type: 'text', id: 'live-text', text: 'Latest reply.' }],
  },
] as AgentMessage[];

const pendingProposals: PendingProposalRef[] = [
  { proposalId: 'Create workspace', messageId: 'history-3' },
];

async function settleAtBottom(host: Locator): Promise<void> {
  const scroll = host.getByTestId('chat-transcript-scroll-viewport');
  await expect(host.locator('[data-message-id="live-response"]')).toContainText('Latest reply.');
  await expect
    .poll(() => scroll.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThanOrEqual(2);
}

test('shows the chip for a genuinely pending off-screen re-proposal', async ({ mount, page }) => {
  await page.setViewportSize({ width: 960, height: 1000 });
  const host = await mount(ChatPanelOperationalGeometryHost, {
    props: { width: 560, liveMessages: messages, pendingProposals },
  });
  await settleAtBottom(host);
  await expect(host.getByTestId('pending-proposal-chip')).toBeVisible();
});

test('hides the chip when the pending ref’s id is already resolved (superseded duplicate title)', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 1000 });
  const host = await mount(ChatPanelOperationalGeometryHost, {
    props: {
      width: 560,
      liveMessages: messages,
      pendingProposals,
      proposalResolutions: { 'Create workspace': 'applied' },
    },
  });
  await settleAtBottom(host);
  // The positive case above shows the chip within the same settle window;
  // give the observer equal time before asserting it never appears.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 1_000))),
      ),
  );
  await expect(host.getByTestId('pending-proposal-chip')).toHaveCount(0);
});
