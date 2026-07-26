/**
 * MIME-keyed card registry (§7.1 standalone resource blocks → card
 * components): ProposalCard is registered under the proposal MIME; unknown
 * MIME types and malformed payloads resolve to null so the rendering
 * components fall through to their legacy branches. Agent Q&A question
 * blocks are deliberately unregistered (wizard-only rendering) and must
 * resolve to null.
 */
import { describe, expect, it, vi } from 'vitest';
import { resolveCard, type CardHandlers } from '../card-registry';
import { PROPOSAL_RESOURCE_MIME_TYPE } from '$shared/types/proposal-resource';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import ProposalCard from '../../proposals/ProposalCard.svelte';

const PROPOSAL = {
  kind: 'workspace-create',
  payload: { operation: 'workspace.create', params: { repositoryPath: '/repo' } },
  preview: { title: 'Create workspace' },
  applyToolCallId: 'tc-1',
};

const QUESTION = {
  attachmentId: 'tar-abc123',
  header: 'Auth method',
  question: 'Which authentication method should the new endpoint use?',
  options: [
    { label: 'OAuth', description: 'Standard OAuth 2.0 flow' },
    { label: 'API key', description: 'Static key in header' },
  ],
  multiSelect: false,
};

function handlers(overrides: Partial<CardHandlers> = {}): CardHandlers {
  return { onProposalApply: vi.fn(), onProposalUndo: vi.fn(), ...overrides };
}

function resourceBlock(mimeType: string, text: string) {
  return {
    type: 'resource',
    resource: { uri: 'intent-proposal://workspace-create/tc-1', name: 'x', mimeType, text },
  };
}

function questionBlock(text: string) {
  return {
    type: 'resource',
    resource: {
      uri: 'intent-question://tar-abc123',
      name: 'Auth method',
      mimeType: QUESTION_RESOURCE_MIME_TYPE,
      text,
    },
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

  it('resolves question-MIME resource blocks to null (wizard-only rendering — no transcript card)', () => {
    // A perfectly well-formed question payload still resolves to null: the
    // composer-slot QuestionWizard is the sole rendering surface, and the
    // transcript renderers additionally strip question blocks entirely via
    // isQuestionResourceBlock before consulting the registry.
    expect(resolveCard(questionBlock(JSON.stringify(QUESTION)), handlers())).toBeNull();
    expect(resolveCard(questionBlock('not json'), handlers())).toBeNull();
  });
});
