/**
 * MIME-keyed card registry (§7.1 standalone resource blocks → card
 * components): ProposalCard is registered under the proposal MIME; unknown
 * MIME types and malformed payloads resolve to null so the rendering
 * components fall through to their legacy branches.
 */
import { describe, expect, it, vi } from 'vitest';
import { resolveCard, type CardHandlers } from '../card-registry';
import { PROPOSAL_RESOURCE_MIME_TYPE } from '$shared/types/proposal-resource';
import ProposalCard from '../../proposals/ProposalCard.svelte';

const PROPOSAL = {
  kind: 'workspace-create',
  payload: { operation: 'workspace.create', params: { repositoryPath: '/repo' } },
  preview: { title: 'Create workspace' },
  applyToolCallId: 'tc-1',
};

function handlers(): CardHandlers {
  return { onProposalApply: vi.fn(), onProposalUndo: vi.fn() };
}

function resourceBlock(mimeType: string, text: string) {
  return {
    type: 'resource',
    resource: { uri: 'intent-proposal://workspace-create/tc-1', name: 'x', mimeType, text },
  };
}

describe('resolveCard', () => {
  it('resolves a proposal-MIME resource block to ProposalCard with parsed props', () => {
    const h = handlers();
    const card = resolveCard(
      resourceBlock(PROPOSAL_RESOURCE_MIME_TYPE, JSON.stringify(PROPOSAL)),
      h,
    );
    expect(card).not.toBeNull();
    expect(card!.component).toBe(ProposalCard);
    expect(card!.props.proposal).toEqual(PROPOSAL);
    expect(card!.props.onApply).toBe(h.onProposalApply);
    expect(card!.props.onUndo).toBe(h.onProposalUndo);
  });

  it('resolves a daemon-registered payload (stamped attachmentId survives isProposal)', () => {
    const stamped = { ...PROPOSAL, attachmentId: 'tar-abc123def456' };
    const card = resolveCard(
      resourceBlock(PROPOSAL_RESOURCE_MIME_TYPE, JSON.stringify(stamped)),
      handlers(),
    );
    expect(card).not.toBeNull();
    expect((card!.props.proposal as { kind: string }).kind).toBe('workspace-create');
  });

  it('returns null for unregistered MIME types', () => {
    expect(
      resolveCard(resourceBlock('application/vnd.intent.unknown+json', '{}'), handlers()),
    ).toBeNull();
  });

  it('returns null for malformed payloads (invalid JSON / not a proposal)', () => {
    expect(
      resolveCard(resourceBlock(PROPOSAL_RESOURCE_MIME_TYPE, 'not json'), handlers()),
    ).toBeNull();
    expect(
      resolveCard(
        resourceBlock(PROPOSAL_RESOURCE_MIME_TYPE, JSON.stringify({ kind: 'nope' })),
        handlers(),
      ),
    ).toBeNull();
  });

  it('returns null for non-resource blocks', () => {
    expect(resolveCard({ type: 'text', text: 'hi' }, handlers())).toBeNull();
    expect(resolveCard(null, handlers())).toBeNull();
  });
});
