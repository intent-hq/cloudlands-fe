import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Proposal, ProposalActionDetail } from '$shared/types/proposal';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import {
  deleteFileSpecialist,
  initialState as specialistsInitialState,
  saveFileSpecialist,
  type FileSpecialist,
} from '$store/renderer/slices/specialists/specialists-slice';
import {
  applyProposalRequested,
  undoProposalRequested,
} from '$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-slice';
import { initialState as modelInitialState } from '$store/renderer/slices/model/model-slice';
import { initialState as providerSettingsInitialState } from '$store/renderer/slices/provider-settings/provider-settings-slice';
import type { StoreState } from '$store/renderer/types';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getState: vi.fn(),
  navigateToSettings: vi.fn(),
}));

vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: mocks.dispatch,
    get state() {
      return mocks.getState();
    },
    createSelector: vi.fn((fn) => ({ select: fn })),
  },
}));

vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToSettings: mocks.navigateToSettings,
}));

import {
  applySpecialistProposal,
  applySpecialistProposalWork,
  undoSpecialistProposal,
  undoSpecialistProposalWork,
} from './specialist-proposal-actions';

function makeState(overrides: Partial<StoreState> = {}): StoreState {
  return {
    specialists: specialistsInitialState,
    model: {
      ...modelInitialState,
      defaultProviderId: 'auggie',
      providerModels: { auggie: 'auggie:sonnet4.5' },
    },
    providerSettings: { ...providerSettingsInitialState },
    specialistProposalHistory: { entries: {} },
    githubAuth: { isAuthenticated: false },
    ...overrides,
  } as StoreState;
}

function makeDetail(proposal: Proposal): ProposalActionDetail {
  return { proposal, editedFields: {}, selectedBulkItemIds: [] };
}

function makeCreateProposal(): Proposal {
  return {
    kind: 'specialist-edit',
    applyToolCallId: 'tool-create-specialist',
    payload: {
      operation: 'create',
      id: 'review-buddy',
      name: 'Review Buddy',
      description: 'Reviews changes',
      model: 'auggie:opus4.5',
      prompt: 'Review carefully.',
      scope: 'user',
    },
    preview: { title: 'Create specialist: Review Buddy' },
  };
}

function existingFileSpecialist(): FileSpecialist {
  return {
    id: 'review-buddy',
    name: 'Review Buddy',
    description: 'Old description',
    codingAgent: 'auggie',
    model: 'auggie:sonnet4.5',
    behaviorPrompt: 'Old prompt',
    roleReminder: 'Stay focused.',
    filePath: '/tmp/review-buddy.md',
    source: 'user',
  };
}

function stateWithExistingSpecialist(): StoreState {
  return makeState({
    specialists: {
      ...specialistsInitialState,
      fileSpecialists: createCollection<FileSpecialist, 'id'>('id', [existingFileSpecialist()]),
    },
  });
}

function makeEditProposal(): Proposal {
  return {
    kind: 'specialist-edit',
    applyToolCallId: 'tool-edit-specialist',
    payload: {
      operation: 'edit',
      id: 'review-buddy',
      description: 'New description',
      prompt: 'New prompt',
    },
    preview: { title: 'Edit specialist: Review Buddy' },
  };
}

function makeDeleteProposal(): Proposal {
  return {
    kind: 'specialist-edit',
    applyToolCallId: 'tool-delete-specialist',
    payload: { operation: 'delete', id: 'review-buddy' },
    preview: { title: 'Delete specialist: Review Buddy' },
  };
}

// Async write actions (saveFileSpecialist/deleteFileSpecialist) carry a
// per-dispatch promise the saga settles with the daemon write outcome; the
// mocked dispatch resolves it so awaited work functions complete.
function settleAsyncActions() {
  mocks.dispatch.mockImplementation((action: { success?: (response: unknown) => unknown }) => {
    action.success?.(undefined);
    return action;
  });
}

function expectDispatchedWrite(
  creator: typeof saveFileSpecialist | typeof deleteFileSpecialist,
  payload: unknown,
) {
  expect(mocks.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ type: creator.type, payload: [payload] }),
  );
}

describe('specialist-proposal-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settleAsyncActions();
    mocks.getState.mockReturnValue(makeState());
  });

  it('dispatches lifecycle apply requests for specialist proposals', () => {
    const proposal = makeCreateProposal();

    expect(applySpecialistProposal(makeDetail(proposal))).toBe(true);

    expect(mocks.dispatch).toHaveBeenCalledWith(
      applyProposalRequested({
        proposalId: 'tool-create-specialist',
        kind: 'specialist-edit',
        detail: makeDetail(proposal),
      }),
    );
  });

  it('returns false for non-specialist proposals without dispatching', () => {
    const proposal: Proposal = {
      kind: 'settings-change',
      applyToolCallId: 'tool-settings',
      payload: { changes: [] },
      preview: { title: 'Change setting' },
    };

    expect(applySpecialistProposal(makeDetail(proposal))).toBe(false);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('applies create proposals with a delete reverse action and focuses the new specialist', async () => {
    const result = await applySpecialistProposalWork(makeDetail(makeCreateProposal()));

    // Writes emit bare model ids only (PROTOCOL §5.11): the compound
    // proposal model splits, its prefix winning as the codingAgent.
    expectDispatchedWrite(saveFileSpecialist, {
      id: 'review-buddy',
      name: 'Review Buddy',
      description: 'Reviews changes',
      codingAgent: 'auggie',
      model: 'opus4.5',
      roleReminder: undefined,
      behaviorPrompt: 'Review carefully.',
      scope: 'user',
      workspacePath: undefined,
    });
    expect(result.reverse).toEqual({
      kind: 'delete',
      id: 'review-buddy',
      scope: 'user',
      workspacePath: undefined,
    });
    expect(mocks.navigateToSettings).toHaveBeenCalledWith({
      tab: 'agents',
      specialist: 'review-buddy',
    });
  });

  it('returns edit proposal reverse action from current specialist values', async () => {
    mocks.getState.mockReturnValue(stateWithExistingSpecialist());

    const result = await applySpecialistProposalWork(makeDetail(makeEditProposal()));

    expect(result.reverse).toEqual({
      kind: 'save',
      specialist: {
        id: 'review-buddy',
        name: 'Review Buddy',
        description: 'Old description',
        codingAgent: 'auggie',
        model: 'auggie:sonnet4.5',
        roleReminder: 'Stay focused.',
        behaviorPrompt: 'Old prompt',
        scope: 'user',
        workspacePath: undefined,
      },
    });
    expect(mocks.navigateToSettings).not.toHaveBeenCalled();
  });

  it('applies delete proposals with a save reverse action from current specialist values', async () => {
    mocks.getState.mockReturnValue(stateWithExistingSpecialist());

    const result = await applySpecialistProposalWork(makeDetail(makeDeleteProposal()));

    expectDispatchedWrite(deleteFileSpecialist, {
      id: 'review-buddy',
      scope: 'user',
      workspacePath: undefined,
    });
    expect(result.reverse).toEqual(expect.objectContaining({ kind: 'save' }));
  });

  it('apply work rejects when the daemon write fails (monorepo review PR#1947)', async () => {
    mocks.dispatch.mockImplementation(
      (action: { failure?: (error: Error) => unknown; promise?: Promise<unknown> }) => {
        action.promise?.catch(() => {});
        action.failure?.(new Error('daemon write failed'));
        return action;
      },
    );

    await expect(applySpecialistProposalWork(makeDetail(makeCreateProposal()))).rejects.toThrow(
      'daemon write failed',
    );
    expect(mocks.navigateToSettings).not.toHaveBeenCalled();
  });

  it('undo work dispatches delete reverse actions', async () => {
    await undoSpecialistProposalWork({ kind: 'delete', id: 'review-buddy', scope: 'user' });

    expectDispatchedWrite(deleteFileSpecialist, {
      id: 'review-buddy',
      scope: 'user',
      workspacePath: undefined,
    });
  });

  it('undo work dispatches save reverse actions', async () => {
    const specialist = {
      id: 'review-buddy',
      name: 'Review Buddy',
      description: 'Restored',
      model: 'auggie:sonnet4.5',
      behaviorPrompt: 'Restored prompt',
      scope: 'user' as const,
    };

    await undoSpecialistProposalWork({ kind: 'save', specialist });

    expectDispatchedWrite(saveFileSpecialist, specialist);
  });

  it('undo work rejects when the daemon write fails (monorepo review PR#1947)', async () => {
    mocks.dispatch.mockImplementation(
      (action: { failure?: (error: Error) => unknown; promise?: Promise<unknown> }) => {
        action.promise?.catch(() => {});
        action.failure?.(new Error('undo write failed'));
        return action;
      },
    );

    await expect(
      undoSpecialistProposalWork({ kind: 'delete', id: 'review-buddy', scope: 'user' }),
    ).rejects.toThrow('undo write failed');
  });

  it('undo dispatches lifecycle requests when history exists', () => {
    mocks.getState.mockReturnValue(
      makeState({
        specialistProposalHistory: {
          entries: {
            'proposal-1': {
              appliedAt: 123,
              reverse: { kind: 'delete', id: 'review-buddy', scope: 'user' },
            },
          },
        },
      }),
    );

    expect(undoSpecialistProposal('proposal-1')).toBe(true);

    expect(mocks.dispatch).toHaveBeenCalledWith(
      undoProposalRequested({
        proposalId: 'proposal-1',
        kind: 'specialist-edit',
      }),
    );
  });

  it('undo returns false when no specialist history entry exists', () => {
    expect(undoSpecialistProposal('missing')).toBe(false);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
