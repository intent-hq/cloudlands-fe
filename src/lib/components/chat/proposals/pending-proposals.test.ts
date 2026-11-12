import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import type { Proposal } from '$shared/types/proposal';
import { createProposalResource } from '$shared/types/proposal-resource';
import {
  classifyPendingProposalRefs,
  derivePendingProposals,
  effectivelyPendingProposalRefs,
  isPendingProposalCard,
  missingPendingProposalMessageIds,
  proposalOutcomeOf,
  pendingProposalKeyOf,
  proposalsOf,
} from './pending-proposals';

function makeProposal(applyToolCallId: string, title = `Proposal ${applyToolCallId}`): Proposal {
  return {
    kind: 'workspace-create',
    applyToolCallId,
    payload: { params: { title } },
    preview: { title, workspaceCreate: { mode: 'sibling', title } },
  } as Proposal;
}

/** proposeSibling-shaped proposal: the daemon injects NO applyToolCallId. */
function makeIdlessProposal(title: string): Proposal {
  return {
    kind: 'workspace-create',
    payload: { params: { title } },
    preview: { title, workspaceCreate: { mode: 'sibling', title } },
  } as Proposal;
}

function carryingMessage(id: string, proposals: Proposal[], isStreaming = false): AgentMessage {
  return {
    id,
    role: 'assistant',
    isStreaming,
    contentBlocks: proposals.map((proposal) => ({
      type: 'resource',
      resource: createProposalResource(proposal),
    })),
  } as unknown as AgentMessage;
}

function residentResolver(messages: AgentMessage[]) {
  const byId = new Map(messages.map((message) => [message.id, message]));
  return (messageId: string) => {
    const message = byId.get(messageId);
    return message && !message.isStreaming ? proposalsOf(message) : undefined;
  };
}

describe('classifyPendingProposalRefs', () => {
  it('returns [] for absent metadata (old daemon graceful degrade)', () => {
    expect(classifyPendingProposalRefs(undefined)).toEqual([]);
  });

  it('returns [] for a non-array value and skips malformed entries', () => {
    expect(classifyPendingProposalRefs('nope')).toEqual([]);
    expect(
      classifyPendingProposalRefs([
        null,
        { proposalId: '', messageId: 'm1' },
        { proposalId: 'p1' },
        { proposalId: 'p1', messageId: 'm1' },
      ]),
    ).toEqual([{ proposalId: 'p1', messageId: 'm1' }]);
  });

  it('dedupes by proposalId keeping the FIRST (metadata order)', () => {
    expect(
      classifyPendingProposalRefs([
        { proposalId: 'p1', messageId: 'm1' },
        { proposalId: 'p1', messageId: 'm2' },
        { proposalId: 'p2', messageId: 'm2' },
      ]),
    ).toEqual([
      { proposalId: 'p1', messageId: 'm1' },
      { proposalId: 'p2', messageId: 'm2' },
    ]);
  });
});

describe('derivePendingProposals', () => {
  it('intersects metadata refs with transcript blocks in metadata order', () => {
    const p1 = makeProposal('toolu-1');
    const p2 = makeProposal('toolu-2');
    const p3 = makeProposal('toolu-3');
    const entries = derivePendingProposals(
      [
        { proposalId: 'toolu-3', messageId: 'm2' },
        { proposalId: 'toolu-1', messageId: 'm1' },
        { proposalId: 'toolu-2', messageId: 'm1' },
      ],
      residentResolver([carryingMessage('m1', [p1, p2]), carryingMessage('m2', [p3])]),
    );
    expect(entries.map((entry) => entry.proposalId)).toEqual(['toolu-3', 'toolu-1', 'toolu-2']);
    expect(entries[1]).toEqual({ proposalId: 'toolu-1', messageId: 'm1', proposal: p1 });
  });

  it('skips refs whose carrying message is unavailable (never invents)', () => {
    const p1 = makeProposal('toolu-1');
    const entries = derivePendingProposals(
      [
        { proposalId: 'toolu-1', messageId: 'm1' },
        { proposalId: 'toolu-9', messageId: 'm-gone' },
      ],
      residentResolver([carryingMessage('m1', [p1])]),
    );
    expect(entries.map((entry) => entry.proposalId)).toEqual(['toolu-1']);
  });

  it('skips refs whose id has no matching block on the carrying message', () => {
    const p1 = makeProposal('toolu-1');
    const entries = derivePendingProposals(
      [{ proposalId: 'toolu-other', messageId: 'm1' }],
      residentResolver([carryingMessage('m1', [p1])]),
    );
    expect(entries).toEqual([]);
  });

  it('does not read blocks off a still-streaming carrying message', () => {
    const p1 = makeProposal('toolu-1');
    const entries = derivePendingProposals(
      [{ proposalId: 'toolu-1', messageId: 'm1' }],
      residentResolver([carryingMessage('m1', [p1], true)]),
    );
    expect(entries).toEqual([]);
  });

  it('returns [] for empty refs', () => {
    expect(derivePendingProposals([], () => undefined)).toEqual([]);
  });
});

describe('pendingProposalKeyOf', () => {
  it('uses applyToolCallId when present, raw preview.title otherwise (daemon parity)', () => {
    expect(pendingProposalKeyOf(makeProposal('toolu-1'))).toBe('toolu-1');
    expect(pendingProposalKeyOf(makeIdlessProposal('Fix flaky CI job'))).toBe('Fix flaky CI job');
  });
});

describe('proposalsOf', () => {
  it('keys parsed proposals by their stable identity and ignores non-assistant rows', () => {
    const p1 = makeProposal('toolu-1');
    const byId = proposalsOf(carryingMessage('m1', [p1]));
    expect([...byId.keys()]).toEqual(['toolu-1']);
    const userRow = { ...carryingMessage('m1', [p1]), role: 'user' } as AgentMessage;
    expect(proposalsOf(userRow).size).toBe(0);
  });

  it('keys id-less (proposeSibling-style) proposals by raw preview.title', () => {
    const idless = makeIdlessProposal('Investigate slow startup');
    const byId = proposalsOf(carryingMessage('m1', [idless]));
    expect([...byId.keys()]).toEqual(['Investigate slow startup']);
    expect(
      derivePendingProposals(
        [{ proposalId: 'Investigate slow startup', messageId: 'm1' }],
        residentResolver([carryingMessage('m1', [idless])]),
      ),
    ).toEqual([{ proposalId: 'Investigate slow startup', messageId: 'm1', proposal: idless }]);
  });
});

describe('missingPendingProposalMessageIds', () => {
  it('names each non-resident carrying message once, metadata order', () => {
    expect(
      missingPendingProposalMessageIds(
        [
          { proposalId: 'p1', messageId: 'm1' },
          { proposalId: 'p2', messageId: 'm2' },
          { proposalId: 'p3', messageId: 'm2' },
        ],
        (messageId) => messageId === 'm1',
      ),
    ).toEqual(['m2']);
  });
});

describe('effectively pending proposals (shared card + pill rule)', () => {
  const agentId = 'agent-1';
  const sources = (over: Partial<Parameters<typeof proposalOutcomeOf>[1]> = {}) => ({
    lifecycle: {},
    resolutions: {},
    ...over,
  });

  it('drops a ref whose id the daemon already resolved (legacy title-keyed real-data shape)', () => {
    const refs = [{ proposalId: 'Create workspace', messageId: 'm65' }];
    const resolved = sources({
      resolutions: {
        'Create workspace': 'applied',
        'workspace-create-d562': 'applied',
      },
    });
    expect(effectivelyPendingProposalRefs(agentId, refs, resolved)).toEqual([]);
    expect(proposalOutcomeOf(agentId, resolved, 'Create workspace', undefined)).toBe('applied');
  });

  it('drops a ref applied or dismissed in the local lifecycle under either key', () => {
    const refs = [
      { proposalId: 'p-scoped', messageId: 'm1' },
      { proposalId: 'p-local', messageId: 'm2' },
      { proposalId: 'p-open', messageId: 'm3' },
    ];
    const local = sources({
      lifecycle: {
        'agent-1::p-scoped': { status: 'dismissed' },
        'card-key-m2': { status: 'applied', completedAt: 2 },
      },
    });
    expect(
      effectivelyPendingProposalRefs(agentId, refs, local, (ref) =>
        ref.messageId === 'm2' ? 'card-key-m2' : undefined,
      ),
    ).toEqual([{ proposalId: 'p-open', messageId: 'm3' }]);
  });

  it('keeps a ref whose local lifecycle is only in flight or failed', () => {
    const refs = [{ proposalId: 'p1', messageId: 'm1' }];
    const inFlight = sources({ lifecycle: { 'agent-1::p1': { status: 'applying' } } });
    expect(effectivelyPendingProposalRefs(agentId, refs, inFlight)).toEqual(refs);
  });

  it('keeps a genuinely pending ref', () => {
    const refs = [{ proposalId: 'p1', messageId: 'm1' }];
    expect(effectivelyPendingProposalRefs(agentId, refs, sources())).toEqual(refs);
  });

  it('treats only the ref’s own message as the pending card for a duplicated title', () => {
    const early = makeIdlessProposal('Create workspace');
    const refs = [{ proposalId: 'Create workspace', messageId: 'm65' }];
    const card = (messageId: string) =>
      isPendingProposalCard({
        agentId,
        refs,
        sources: sources(),
        proposal: early,
        messageId,
        localId: `local@${messageId}`,
      });
    expect(card('m4')).toBe(false);
    expect(card('m65')).toBe(true);
  });

  it('marks only the first same-key card in one message as pending', () => {
    const first = {
      ...makeIdlessProposal('Create workspace'),
      payload: { params: { title: 'A' } },
    } as Proposal;
    const second = {
      ...makeIdlessProposal('Create workspace'),
      payload: { params: { title: 'B' } },
    } as Proposal;
    const message = carryingMessage('m65', [first, second]);
    const refs = [{ proposalId: 'Create workspace', messageId: 'm65' }];
    const card = (proposal: Proposal) =>
      isPendingProposalCard({
        agentId,
        refs,
        sources: sources(),
        proposal,
        messageId: 'm65',
        localId: 'local',
        messageProposals: proposalsOf(message),
      });
    expect(card({ ...first, applyToolCallId: undefined } as Proposal)).toBe(true);
    expect(card(second)).toBe(false);
  });

  it('never marks a resolved card pending even when its ref is still listed', () => {
    const proposal = makeIdlessProposal('Create workspace');
    expect(
      isPendingProposalCard({
        agentId,
        refs: [{ proposalId: 'Create workspace', messageId: 'm65' }],
        sources: sources({ resolutions: { 'Create workspace': 'applied' } }),
        proposal,
        messageId: 'm65',
        localId: 'local',
      }),
    ).toBe(false);
  });
});
