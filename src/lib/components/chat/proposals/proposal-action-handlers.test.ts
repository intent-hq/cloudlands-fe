import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceCreateProposal } from '$shared/types/proposal';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn((action: unknown) => Promise.resolve(action)),
}));

vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: mocks.dispatch,
    state: {},
    createSelector: vi.fn((fn) => ({
      select: fn,
      withStore: () => () => ({ subscribe: () => () => {} }),
    })),
  },
}));

vi.mock('./proposal-draft-storage', () => ({ clearProposalDraft: vi.fn() }));

import { applyProposal, dismissProposal } from './proposal-action-handlers';

const proposal: WorkspaceCreateProposal = {
  kind: 'workspace-create',
  payload: {
    operation: 'workspace.create',
    params: {
      title: 'New space',
      repositoryPath: '/repo',
      baseRef: 'main',
      initialAgent: { prompt: 'Go', specialist: 'reviewer' },
    },
  },
  preview: { title: 'Create workspace' },
  applyToolCallId: 'dismiss-create',
};

describe('dismissProposal', () => {
  beforeEach(() => mocks.dispatch.mockClear());

  it('resolves a dismissed workspace-create proposal without recording its specialist', async () => {
    await dismissProposal('agent-1', 'ws-1', {
      proposalId: 'dismiss-create',
      messageId: 'message-1',
      proposal,
    });

    const types = mocks.dispatch.mock.calls.map(([action]) => (action as { type: string }).type);
    expect(types).toEqual(['agentSessions/resolveProposalRequested']);
    expect(types).not.toContain('workspaceInitializer/rememberRecentSpecialist');
  });
});

describe('applyProposal', () => {
  beforeEach(() => mocks.dispatch.mockClear());

  const appliedPayload = () =>
    (mocks.dispatch.mock.calls[0]?.[0] as { payload: [Record<string, unknown>] }).payload[0];

  it('names the card as the workspace.create origin so the daemon resolves it (intent-hq/intent#8086)', () => {
    applyProposal('agent-1', { proposal, editedFields: { title: 'Edited' } });

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(appliedPayload()).toMatchObject({
      proposal,
      editedFields: { title: 'Edited' },
      origin: { kind: 'proposal', agentId: 'agent-1', proposalId: 'dismiss-create' },
    });
  });

  it('falls back to the preview title as the pending key when the proposal has no tool call id', () => {
    const { applyToolCallId: _drop, ...untitled } = proposal;
    applyProposal('agent-1', { proposal: untitled });

    expect(appliedPayload().origin).toEqual({
      kind: 'proposal',
      agentId: 'agent-1',
      proposalId: 'Create workspace',
    });
  });

  it('sends no origin without an agent id or for bulk proposals', () => {
    applyProposal('', { proposal });
    applyProposal('agent-1', {
      proposal: {
        kind: 'bulk-op',
        payload: { operation: 'workspace.bulkArchive', ids: ['ws-1'] },
        preview: { title: 'Bulk operation' },
        applyToolCallId: 'tc-bulk',
      },
    });

    for (const [action] of mocks.dispatch.mock.calls) {
      expect((action as { payload: [Record<string, unknown>] }).payload[0]).not.toHaveProperty(
        'origin',
      );
    }
  });
});
