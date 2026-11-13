/**
 * @vitest-environment jsdom
 */
// A workspace suggestion card applied end to end: the real card, the apply
// handler, the workspace-operations saga and LiveWorkspacesClient over the
// scripted daemon transport, so the `workspace.create` request and its
// response are checked on the wire (PROTOCOL workspace.md `workspace.create`).
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Proposal } from '$shared/types/proposal';

vi.mock('$lib/client/live/backend-transport', async () => {
  const mod = await import('../../../../test/mocks/backend-transport.mock');
  return mod.mockBackendTransportModule;
});
vi.mock('$lib/client', async () => {
  const { LiveWorkspacesClient } = await import('$lib/client/live/live-workspaces-client');
  return { appClient: { workspaces: new LiveWorkspacesClient() } };
});
vi.mock('$lib/components/patterns/notify', async () => ({
  ...(await vi.importActual('$lib/components/ui/toast/toast-countdown')),
  notify: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
}));
// Pickers with their own coverage; the card's state and request are under test.
vi.mock('$lib/components/workspace/initializer/RepoAndBranchPicker.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockRepoAndBranchPicker.svelte'))
    .default,
}));
vi.mock('$lib/components/chat/SpecialistDropdown.svelte', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/MockSpecialistDropdown.svelte'))
    .default,
}));
vi.mock('./ProposalStartOn.svelte', async () => ({
  default: (await import('./__tests__/MockProposalStartOn.svelte')).default,
}));

import {
  installMockBackend,
  resetMockBackend,
} from '../../../../test/mocks/backend-transport.mock';
import { withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { store } from '$store/renderer/store';
import { workspaceOperationsSaga } from '$store/renderer/slices/workspace-operations/sagas/workspace-operations-saga';
import { setFileSpecialists } from '$store/renderer/slices/specialists/specialists-slice';
import { loadEnabledProvidersFromStorage } from '$store/renderer/slices/provider-settings/provider-settings-slice';
import { hydrateWorkspaceInitializer } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import ProposalCard from './ProposalCard.svelte';
import { applyProposal } from './proposal-action-handlers';
import { getProposalId } from './proposal-id';

const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const AGENT_ID = 'proposing-agent';

/** A `workspace.create` result shaped like the protocol's `{ workspace, initialAgent? }`. */
function createdResult(params: Record<string, unknown>) {
  return {
    workspace: {
      id: WORKSPACE_ID,
      title: params.title,
      branch: 'investigate-follow-up',
      status: 'Active',
      archived: false,
      repositoryPath: params.repositoryPath,
      createdAt: '2026-11-13T00:00:00.000Z',
      updatedAt: '2026-11-13T00:00:00.000Z',
    },
    initialAgent: { id: 'created-agent', name: 'Implementor', status: 'idle' },
  };
}

function proposal(): Proposal {
  return {
    kind: 'workspace-create',
    applyToolCallId: 'wire-create-proposal',
    payload: {
      operation: 'workspace.create',
      params: {
        title: 'Investigate follow-up',
        repositoryPath: '/repo/current',
        initialAgent: { prompt: 'Inspect the separate issue.' },
      },
    },
    preview: {
      title: 'Investigate follow-up',
      workspaceCreate: {
        title: 'Investigate follow-up',
        initialPrompt: 'Inspect the separate issue.',
        repoPath: '/repo/current',
        branch: 'main',
      },
    },
  } as Proposal;
}

const stops: Array<() => void> = [];

beforeEach(() => {
  stops.push(store.init(withLegacyPrincipal({})));
  stops.push(store.runSaga(workspaceOperationsSaga));
  store.dispatch(
    setFileSpecialists([
      {
        id: 'implementor',
        name: 'Implementor',
        description: '',
        model: '',
        behaviorPrompt: '',
        filePath: '/fixture/implementor.md',
        source: 'user',
      },
    ]),
  );
});

afterEach(() => {
  while (stops.length) stops.pop()?.();
  resetMockBackend();
});

async function applyCard() {
  const p = proposal();
  render(ProposalCard, {
    props: { proposal: p, onApply: (detail) => applyProposal(AGENT_ID, detail) },
  });
  await fireEvent.click(screen.getByRole('button', { name: /Create workspace/ }));
  return getProposalId(p);
}

describe('workspace suggestion card → workspace.create', () => {
  it('omits a remembered provider, model and effort whose provider is turned off', async () => {
    const backend = installMockBackend();
    backend.onRequest('workspace.create', (params) =>
      createdResult(params as Record<string, unknown>),
    );
    store.dispatch(loadEnabledProvidersFromStorage({ 'claude-code': false, codex: true }));
    store.dispatch(
      hydrateWorkspaceInitializer({
        agentByRepo: {
          'local:/repo/current': {
            isTeamMode: false,
            selectedSpecialist: 'implementor',
            selectedProvider: 'claude-code',
            selectedModel: 'claude-opus-4-5',
            modelWasOverridden: true,
            selectedReasoningEffort: 'high',
          },
        },
      }),
    );

    const proposalId = await applyCard();

    await waitFor(() => expect(store.state.proposalLifecycle[proposalId]?.status).toBe('applied'));
    const creates = backend.requests.filter((r) => r.method === 'workspace.create');
    expect(creates).toHaveLength(1);
    const params = creates[0].params as Record<string, unknown>;
    expect(params).toMatchObject({
      title: 'Investigate follow-up',
      repositoryPath: '/repo/current',
      baseRef: 'main',
      origin: { kind: 'proposal', agentId: AGENT_ID, proposalId: 'wire-create-proposal' },
      initialAgent: {
        // The remembered agent still applies; only its setup is dropped.
        specialist: 'implementor',
        prompt: 'Inspect the separate issue.',
      },
    });
    const initialAgent = params.initialAgent as Record<string, unknown>;
    expect(initialAgent).not.toHaveProperty('provider');
    expect(initialAgent).not.toHaveProperty('model');
    expect(initialAgent).not.toHaveProperty('reasoningEffort');
    expect(typeof params.idempotencyKey).toBe('string');

    // The created workspace lands in the store and the card resolves applied.
    expect(getItem(store.state.workspace.workspaces, WORKSPACE_ID)).toMatchObject({
      title: 'Investigate follow-up',
    });
    expect(store.state.proposalLifecycle[proposalId]).toMatchObject({
      result: { workspaceId: WORKSPACE_ID },
    });
  });

  it('sends the remembered provider, model and effort while that provider is on', async () => {
    const backend = installMockBackend();
    backend.onRequest('workspace.create', (params) =>
      createdResult(params as Record<string, unknown>),
    );
    store.dispatch(loadEnabledProvidersFromStorage({ 'claude-code': true, codex: true }));
    store.dispatch(
      hydrateWorkspaceInitializer({
        agentByRepo: {
          'local:/repo/current': {
            isTeamMode: false,
            selectedSpecialist: 'implementor',
            selectedProvider: 'claude-code',
            selectedModel: 'claude-opus-4-5',
            modelWasOverridden: true,
            selectedReasoningEffort: 'high',
          },
        },
      }),
    );

    const proposalId = await applyCard();

    await waitFor(() => expect(store.state.proposalLifecycle[proposalId]?.status).toBe('applied'));
    const params = backend.requests.find((r) => r.method === 'workspace.create')?.params as Record<
      string,
      unknown
    >;
    expect(params.initialAgent).toMatchObject({
      specialist: 'implementor',
      provider: 'claude-code',
      model: 'claude-opus-4-5',
      reasoningEffort: 'high',
    });
  });
});
