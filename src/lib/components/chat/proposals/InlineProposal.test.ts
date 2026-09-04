/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Proposal } from '$shared/types/proposal';

const state = vi.hoisted(() => ({
  pendingProposals: [] as Array<{ proposalId: string; messageId: string }>,
  proposalResolutions: {} as Record<string, 'applied' | 'dismissed'>,
  lifecycle: {} as Record<
    string,
    {
      status: 'idle' | 'applying' | 'applied' | 'undoing' | 'failed' | 'dismissed';
      error?: string;
      completedAt?: number;
      result?: { workspaceId?: string };
    }
  >,
  cardStatus: 'idle' as 'idle' | 'applying' | 'applied' | 'undoing' | 'failed',
  cardError: null as string | null,
}));

const actionMocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  resolve: vi.fn(),
  applyWorkspace: vi.fn((payload) => ({ type: 'workspace/apply', payload: [payload] })),
  applySpecialist: vi.fn(() => false),
  applySettings: vi.fn(() => false),
  undoSpecialist: vi.fn(() => false),
  undoSettings: vi.fn(() => true),
  goto: vi.fn(),
}));

function readable<T>(value: () => T) {
  return {
    subscribe(run: (current: T) => void) {
      run(value());
      return () => {};
    },
  };
}

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: vi.fn(() =>
    readable(() => ({
      metadata: {
        pendingProposals: state.pendingProposals,
        proposalResolutions: state.proposalResolutions,
      },
    })),
  ),
}));
vi.mock('$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-selectors', () => ({
  selectProposalLifecycleMap: vi.fn(() => readable(() => state.lifecycle)),
  selectProposalStatus: vi.fn(() => readable(() => state.cardStatus)),
  selectProposalError: vi.fn(() => readable(() => state.cardError)),
  selectProposalErrorCode: vi.fn(() => readable(() => null)),
  selectProposalResult: vi.fn(() => readable(() => null)),
}));
vi.mock('$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-slice', () => ({
  agentScopedProposalKey: (agentId: string, proposalId: string) => `${agentId}::${proposalId}`,
}));
vi.mock('$store/renderer/slices/agent-session/agent-session-slice', () => ({
  agentProposalResolveRequested: (...args: unknown[]) => {
    actionMocks.resolve(...args);
    return { type: 'agent/resolve', payload: args, promise: Promise.resolve() };
  },
}));
vi.mock('$store/renderer/slices/workspace-operations/workspace-operations-slice', () => ({
  applyWorkspaceProposal: actionMocks.applyWorkspace,
}));
vi.mock('./settings-proposal-actions', () => ({
  applySettingsProposal: actionMocks.applySettings,
  undoSettingsProposal: actionMocks.undoSettings,
}));
vi.mock('./specialist-proposal-actions', () => ({
  applySpecialistProposal: actionMocks.applySpecialist,
  undoSpecialistProposal: actionMocks.undoSpecialist,
}));
vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: actionMocks.dispatch,
    state: {},
    createSelector: vi.fn((fn) => ({
      select: fn,
      withStore: () => () => ({ subscribe: () => () => {} }),
    })),
  },
}));
vi.mock('$app/navigation', () => ({ goto: actionMocks.goto }));
vi.mock('$lib/components/workspace/initializer/RepoAndBranchPicker.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockRepoAndBranchPicker.svelte'))
    .default,
}));
vi.mock('$lib/components/chat/SpecialistDropdown.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSpecialistDropdown.svelte'))
    .default,
}));
vi.mock('$store/renderer/slices/pr-branch-lookup/pr-branch-lookup-selectors', () => ({
  selectPrBranchLookupEntries: vi.fn(() => readable(() => ({}))),
}));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectWorkspaceAgentIds: vi.fn(() => readable(() => [])),
  selectWorkspaceAgentsLoading: vi.fn(() => readable(() => false)),
  selectIsWorkspaceAgentCreating: vi.fn(() => readable(() => false)),
  selectActiveAgentIdForWorkspace: vi.fn(() => readable(() => undefined)),
  selectAgentIdByInitialMessage: vi.fn(() => readable(() => undefined)),
}));
vi.mock('$store/renderer/slices/workspaces/workspaces-selectors', () => ({
  selectWorkspaceById: vi.fn(() => readable(() => undefined)),
}));
vi.mock('$store/renderer/slices/active-context/active-context-selectors', () => ({
  selectActiveWorkspaceId: vi.fn(() => readable(() => 'workspace-inline')),
}));
vi.mock('$store/renderer/slices/active-context/active-context-slice', () => ({
  setActiveWorkspace: vi.fn(),
}));
vi.mock(
  '$store/renderer/slices/settings-proposal-history/settings-proposal-history-selectors',
  () => ({ selectProposalAppliedState: vi.fn(() => readable(() => null)) }),
);
vi.mock(
  '$store/renderer/slices/specialist-proposal-history/specialist-proposal-history-selectors',
  () => ({ selectSpecialistProposalAppliedState: vi.fn(() => readable(() => null)) }),
);

import InlineProposal from './InlineProposal.svelte';
import { getProposalId } from './proposal-id';

const AGENT_ID = 'agent-inline';
const WORKSPACE_ID = 'workspace-inline';

function makeBulkProposal(id: string): Proposal {
  return {
    kind: 'bulk-op',
    applyToolCallId: id,
    payload: { operation: 'workspace.bulkArchive', ids: ['workspace-a'] },
    preview: { title: `Archive from ${id}`, applyLabel: 'Archive' },
  };
}

function makeWorkspaceProposal(id: string): Proposal {
  return {
    kind: 'workspace-create',
    applyToolCallId: id,
    payload: { operation: 'workspace.create', params: {} },
    preview: { title: 'Create review workspace' },
  };
}

function renderProposal(proposal: Proposal, messageId = 'message-inline') {
  return render(InlineProposal, {
    props: { agentId: AGENT_ID, workspaceId: WORKSPACE_ID, messageId, proposal },
  });
}

beforeEach(() => {
  state.pendingProposals = [];
  state.proposalResolutions = {};
  state.lifecycle = {};
  state.cardStatus = 'idle';
  state.cardError = null;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('InlineProposal', () => {
  it('renders a metadata-pending ProposalCard and routes Apply and confirmed Dismiss', async () => {
    const proposal = makeBulkProposal('tool-pending');
    state.pendingProposals = [{ proposalId: 'tool-pending', messageId: 'message-inline' }];
    renderProposal(proposal);

    await fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(actionMocks.applyWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ proposal, selectedBulkItemIds: [] }),
    );

    await fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(actionMocks.resolve).not.toHaveBeenCalled();
    await fireEvent.click(await screen.findByRole('button', { name: 'Dismiss proposal' }));
    expect(actionMocks.resolve).toHaveBeenCalledWith(AGENT_ID, WORKSPACE_ID, {
      proposalId: 'tool-pending',
      outcome: 'dismissed',
    });
  });

  it('renders an applied workspace outcome with a link to the created workspace', async () => {
    const proposal = makeWorkspaceProposal('tool-applied');
    state.pendingProposals = [{ proposalId: 'tool-applied', messageId: 'message-inline' }];
    state.lifecycle = {
      'tool-applied': {
        status: 'applied',
        completedAt: 10,
        result: { workspaceId: 'workspace-created' },
      },
    };
    renderProposal(proposal);

    expect(screen.getByText('Workspace created.')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Open workspace' });
    expect(link.getAttribute('href')).toBe('/workspace/workspace-created');
    await fireEvent.click(link);
    expect(actionMocks.goto).toHaveBeenCalledWith('/workspace/workspace-created');
    expect(actionMocks.resolve).toHaveBeenCalledWith(AGENT_ID, WORKSPACE_ID, {
      proposalId: 'tool-applied',
      outcome: 'applied',
      detail: 'Created workspace workspace-created.',
    });
  });

  it('renders a daemon-reconciled dismissed outcome without actions', () => {
    const proposal = makeBulkProposal('tool-dismissed');
    state.lifecycle = {
      [`${AGENT_ID}::tool-dismissed`]: { status: 'dismissed', completedAt: 20 },
    };
    renderProposal(proposal);

    expect(screen.getByText('Dismissed.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a daemon-resolved outcome without a local lifecycle entry', () => {
    const proposal = makeBulkProposal('tool-daemon-dismissed');
    state.proposalResolutions = { 'tool-daemon-dismissed': 'dismissed' };
    renderProposal(proposal);

    expect(screen.getByText('Dismissed.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps title-keyed proposals agent-scoped and reconciles apply under the title', async () => {
    const title = 'Create title-keyed workspace';
    const proposal: Proposal = {
      kind: 'workspace-create',
      payload: { operation: 'workspace.create', params: {} },
      preview: { title, applyLabel: 'Create workspace' },
    };
    state.pendingProposals = [{ proposalId: title, messageId: 'message-inline' }];
    state.lifecycle = { [`agent-other::${title}`]: { status: 'dismissed', completedAt: 10 } };
    const view = renderProposal(proposal);

    expect(screen.queryByText('Dismissed.')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /^Create workspace/ }));
    expect(actionMocks.applyWorkspace).toHaveBeenCalledWith(expect.objectContaining({ proposal }));

    view.unmount();
    state.lifecycle = { [getProposalId(proposal)]: { status: 'applied', completedAt: 20 } };
    renderProposal(proposal);
    await vi.waitFor(() => {
      expect(actionMocks.resolve).toHaveBeenCalledWith(AGENT_ID, WORKSPACE_ID, {
        proposalId: title,
        outcome: 'applied',
      });
    });
  });

  it('keeps a failed pending proposal interactive and routes Retry through Apply', async () => {
    const proposal = makeBulkProposal('tool-failed');
    state.pendingProposals = [{ proposalId: 'tool-failed', messageId: 'message-inline' }];
    state.lifecycle = {
      'tool-failed': { status: 'failed', error: 'Archive failed', completedAt: 30 },
    };
    state.cardStatus = 'failed';
    state.cardError = 'Archive failed';
    renderProposal(proposal);

    expect(screen.getByRole('status').textContent).toContain('Archive failed');
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(actionMocks.applyWorkspace).toHaveBeenCalledOnce();
  });

  it('offers Undo for applied proposal kinds with undo support', async () => {
    const proposal: Proposal = {
      kind: 'settings-change',
      applyToolCallId: 'tool-settings',
      payload: { changes: [] },
      preview: { title: 'Change theme' },
    };
    state.lifecycle = { 'tool-settings': { status: 'applied', completedAt: 40 } };
    renderProposal(proposal);

    await fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(actionMocks.undoSettings).toHaveBeenCalledWith('tool-settings');
  });
});
