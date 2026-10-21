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

import { dismissProposal } from './proposal-action-handlers';

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
