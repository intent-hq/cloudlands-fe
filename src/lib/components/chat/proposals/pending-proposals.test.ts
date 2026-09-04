import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import type { Proposal } from '$shared/types/proposal';
import { createProposalResource } from '$shared/types/proposal-resource';
import {
  classifyPendingProposalRefs,
  derivePendingProposals,
  missingPendingProposalMessageIds,
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
