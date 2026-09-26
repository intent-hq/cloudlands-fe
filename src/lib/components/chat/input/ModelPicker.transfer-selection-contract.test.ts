// @verify-changed-triggers: scripts/transfer-selection-fixtures.mjs, .github/workflows/intent-pr.yml
// The shared contract/golden live outside this package; the connected gate owns their changes.

import { withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { AgentSession } from '$shared/types/agent-session';
import { getAgentProvider } from '$shared/types/agent-session';
import { loadTransferSelectionFixtures } from '../../../../../scripts/transfer-selection-fixtures.mjs';

const context = vi.hoisted(() => ({
  state: {} as ReturnType<typeof makeState>,
  session: undefined as AgentSession | undefined,
  dispatch: vi.fn(),
}));

// Only state/transport boundaries are isolated. Identity, provider catalog,
// provider settings and model selectors, catalog adapters, reducers, and the
// picker remain real.
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => context.state,
    dispatch: context.dispatch,
    dedupeEmits: true,
  });
});
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
import {
  initialState as catalogInitialState,
  providerCatalogLoaded,
  providerCatalogReducer,
} from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import {
  initialState as modelInitialState,
  modelReducer,
} from '$store/renderer/slices/model/model-slice';
import {
  initialState as providerModelsInitialState,
  providerModelsReducer,
} from '$store/renderer/slices/provider-models/provider-models-slice';
import { backendRequest } from '$lib/client/live/backend-transport';
import '$store/renderer/seeders/model-catalog-bridge-seeder';
import ModelPicker from './ModelPicker.svelte';

// Validation is mandatory at collection time, before any component is mounted.
const { contract, artifact } = await loadTransferSelectionFixtures();
console.info('Transfer-selection renderer input:', JSON.stringify(artifact.provenance));

function makeState(codexEnabled: boolean) {
  return withLegacyPrincipal({
    providerCatalog: providerCatalogReducer(
      catalogInitialState,
      providerCatalogLoaded(contract.providersCatalog),
    ),
    providerSettings: { enabledProviders: { ...contract.enabledProviders, codex: codexEnabled } },
    model: {
      ...structuredClone(modelInitialState),
      defaultProviderId: contract.destinationDefaults.provider,
      defaultReasoningEffort: contract.destinationDefaults.reasoningEffort,
      providerModels: {
        [contract.destinationDefaults.provider]: contract.destinationDefaults.model,
      },
    },
    providerModels: structuredClone(providerModelsInitialState),
    agentAvailability: {
      hasCheckedOnce: true,
      providerStatusMap: Object.fromEntries(
        contract.providersCatalog.providers.map(({ id }) => [id, { available: true }]),
      ),
    },
    daemonHealth: { health: 'healthy' },
    workspace: { hasLoaded: true, workspaces: createCollection('id') },
    connections: { windowBackendId: 'local', hasReceivedList: true },
    guestSessions: {
      sessions: createCollection('id'),
      hasReceivedList: true,
      listUnavailable: false,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('electronAPI', undefined);
  context.dispatch.mockImplementation((action) => {
    context.state = {
      ...context.state,
      model: modelReducer(context.state.model, action),
      providerModels: providerModelsReducer(context.state.providerModels, action),
    };
    (store as unknown as { emitState(): void }).emitState();
    return action;
  });
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
  context.session = undefined;
  vi.unstubAllGlobals();
});

async function mountSession(session: AgentSession, codexEnabled: boolean) {
  context.state = makeState(codexEnabled);
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
    expect(context.state.model.loadingState.auggie?.status).toBe('success');
    expect(context.state.model.loadingState.codex?.status).toBe('success');
  });
  await tick();
  // Model loading must preserve each daemon ID, with provenance in the
  // provider cache key. Prefixed values would exercise the legacy ID path.
  for (const { id: providerId } of contract.providersCatalog.providers) {
    expect(backendRequest).toHaveBeenCalledWith('models.list', { providerId });
    expect(
      context.state.providerModels.byProviderId[providerId]?.models.map(({ value }) => value),
    ).toEqual(contract.models[providerId].map(({ id }) => id));
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
      assertSelection(trigger, expected.renderer.label);
      assertNoChanges();
      expect(row.session).toEqual(original);
    });
  }

  it('detects an equivalent historical alias response through the renderer, without hash checks', async () => {
    const row = artifact.cases.find(({ id }) => id === 'acp:direct:codex=false');
    // Deliberately bypass fixture validation for this control alone. A valid
    // daemon response is changed only at the historical public identity seam.
    const session = { ...row.session, provider: 'acp' };
    const trigger = await mountSession(session, false);
    expect(trigger.querySelector('[title]')?.getAttribute('title')).toMatch(/disabled/);
    expect(trigger.querySelector('[data-icon="triangle-exclamation"]')).not.toBeNull();
    expect(() => assertSelection(trigger, contract.expectations.explicit.renderer.label)).toThrow();
  });
});
