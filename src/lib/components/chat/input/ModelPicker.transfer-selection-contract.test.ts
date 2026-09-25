// @verify-changed-triggers: scripts/transfer-selection-fixtures.mjs, .github/workflows/intent-pr.yml
// The shared contract/golden live outside this package; the connected gate owns their changes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { AgentSession } from '$shared/types/agent-session';
import { getAgentProvider } from '$shared/types/agent-session';
import { loadTransferSelectionFixtures } from '../../../../../scripts/transfer-selection-fixtures.mjs';

const context = vi.hoisted(() => ({
  session: undefined as AgentSession | undefined,
  dispatch: vi.fn(),
}));

// Only session/transport boundaries are isolated. The configured Store,
// catalog owner, identity, catalog/settings/model selectors, adapters,
// reducers, and picker remain real.
vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', async () => {
  const { readable } = await import('svelte/store');
  return {
    selectAgentSession: Object.assign(() => readable(context.session), {
      select: () => context.session,
    }),
    selectAgentReasoningEffort: Object.assign(() => readable(context.session?.reasoningEffort), {
      select: () => context.session?.reasoningEffort,
    }),
  };
});
vi.mock('$features/agent/agent.client', () => ({
  agentClient: { setModel: vi.fn(async () => ({ ok: true, data: { success: true } })) },
}));
vi.mock('$features/agent/reasoning-effort', () => ({
  applyReasoningEffort: vi.fn(async () => true),
  reconcileAgentReasoningEffort: vi.fn(async () => true),
}));
vi.unmock('$lib/electron-bridge');
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToSettings: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));

import { store } from '$store/renderer/store';
import { agentClient } from '$features/agent/agent.client';
import {
  applyReasoningEffort,
  reconcileAgentReasoningEffort,
} from '$features/agent/reasoning-effort';
import { notify } from '$lib/components/patterns/notify';
import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import {
  hydrateDefaultProvider,
  loadDefaultReasoningEffortFromStorage,
  loadProviderModelsFromStorage,
} from '$store/renderer/slices/model/model-slice';
import { loadEnabledProvidersFromStorage } from '$store/renderer/slices/provider-settings/provider-settings-slice';
import {
  checkAllProvidersComplete,
  checkSingleProviderSuccess,
} from '$store/renderer/slices/agent-availability/agent-availability-slice';
import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
import { setWorkspaceHasLoaded } from '$store/renderer/slices/workspace/workspace-slice';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import { modelReloadSaga } from '$store/renderer/slices/model/sagas/model-reload-saga';
import { backendRequest } from '$lib/client/live/backend-transport';
import '$store/renderer/seeders/model-catalog-bridge-seeder';
import ModelPicker from './ModelPicker.svelte';

// Validation is mandatory at collection time, before any component is mounted.
const { contract, artifact } = await loadTransferSelectionFixtures();
console.info('Transfer-selection renderer input:', JSON.stringify(artifact.provenance));

function hydrateFixtureState(codexEnabled: boolean) {
  store.dispatch(providerCatalogLoaded(contract.providersCatalog));
  store.dispatch(
    loadEnabledProvidersFromStorage({ ...contract.enabledProviders, codex: codexEnabled }),
  );
  store.dispatch(hydrateDefaultProvider(contract.destinationDefaults.provider));
  store.dispatch(
    loadDefaultReasoningEffortFromStorage(contract.destinationDefaults.reasoningEffort),
  );
  store.dispatch(
    loadProviderModelsFromStorage({
      [contract.destinationDefaults.provider]: contract.destinationDefaults.model,
    }),
  );
  for (const { id } of contract.providersCatalog.providers) {
    store.dispatch(checkSingleProviderSuccess(id, { available: true }));
  }
  store.dispatch(checkAllProvidersComplete());
  store.dispatch(connectionStatusChanged('connected'));
  store.dispatch(setWorkspaceHasLoaded(true));
  store.dispatch(
    connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
  );
  store.dispatch(guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }));
}

let disposeStore: () => void;
let cancelCatalog: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('electronAPI', undefined);
  disposeStore = store.init();
  const dispatch = store.dispatch.bind(store);
  vi.spyOn(store, 'dispatch').mockImplementation((action) => {
    context.dispatch(action);
    return dispatch(action);
  });
  cancelCatalog = store.runSaga(modelReloadSaga);
  vi.mocked(backendRequest).mockImplementation(async (method, params) => {
    expect(method).toBe('models.list');
    const { providerId } = params as { providerId: string };
    expect(params).toEqual({ providerId });
    expect(contract.models).toHaveProperty(providerId);
    return { providerId, models: contract.models[providerId] };
  });
});

afterEach(() => {
  cleanup();
  cancelCatalog();
  vi.restoreAllMocks();
  disposeStore();
  context.session = undefined;
  vi.unstubAllGlobals();
});

async function mountSession(session: AgentSession, codexEnabled: boolean) {
  hydrateFixtureState(codexEnabled);
  context.session = session;
  render(ModelPicker, {
    props: {
      agentId: session.id,
      workspaceId: session.workspaceId,
      selectedModel: session.model,
      portal: false,
    },
  });
  await waitFor(() => {
    expect(store.state.model.loadingState.auggie?.status).toBe('success');
    expect(store.state.model.loadingState.codex?.status).toBe('success');
  });
  await tick();
  // Model loading must preserve each daemon ID, with provenance in the
  // provider cache key. Prefixed values would exercise the legacy ID path.
  for (const { id: providerId } of contract.providersCatalog.providers) {
    expect(backendRequest).toHaveBeenCalledWith('models.list', { providerId });
    expect(
      store.state.providerModels.byProviderId[providerId]?.models.map(({ value }) => value),
    ).toEqual(contract.models[providerId].map(({ id }: { id: string }) => id));
  }
  return screen.getByRole('button');
}

function assertSelection(trigger: HTMLElement, expectedLabel: string) {
  expect(trigger.querySelector('[title]')?.getAttribute('title')).toBe(expectedLabel);
  expect(trigger.textContent).toContain(expectedLabel);
  expect(trigger.querySelector('[data-icon="triangle-exclamation"]')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
}

function assertNoChanges() {
  expect(agentClient.setModel).not.toHaveBeenCalled();
  expect(applyReasoningEffort).not.toHaveBeenCalled();
  expect(reconcileAgentReasoningEffort).not.toHaveBeenCalled();
  for (const toast of Object.values(notify)) expect(toast).not.toHaveBeenCalled();
  expect(context.dispatch.mock.calls.map(([action]) => action.type)).not.toEqual(
    expect.arrayContaining([
      expect.stringMatching(
        /^(model\/(setModelFallbackInfo|selectModel)|agentSession\/updateSession)$/,
      ),
    ]),
  );
}

describe('imported public sessions preserve the ModelPicker selection', () => {
  for (const [index, row] of artifact.cases.entries()) {
    const input = contract.cases[index];
    const expected = contract.expectations[input.expectation];
    it(row.id, async () => {
      const original = structuredClone(row.session);
      expect(vi.isMockFunction(getAgentProvider)).toBe(false);
      expect(getAgentProvider(row.session, contract.destinationDefaults.provider)).toBe(
        expected.selection.provider,
      );
      const trigger = await mountSession(row.session, input.codexEnabled);
      await waitFor(() => assertSelection(trigger, expected.renderer.label));
      assertNoChanges();
      expect(row.session).toEqual(original);
    });
  }

  it('detects an equivalent historical alias response through the renderer, without hash checks', async () => {
    const row = artifact.cases.find(({ id }: { id: string }) => id === 'acp:direct:codex=false');
    // Deliberately bypass fixture validation for this control alone. A valid
    // daemon response is changed only at the historical public identity seam.
    const session = { ...row.session, provider: 'acp' };
    const trigger = await mountSession(session, false);
    await waitFor(() => {
      expect(trigger.querySelector('[title]')?.getAttribute('title')).toMatch(/disabled/);
      expect(trigger.querySelector('[data-icon="triangle-exclamation"]')).not.toBeNull();
    });
    expect(() => assertSelection(trigger, contract.expectations.explicit.renderer.label)).toThrow();
  });
});
