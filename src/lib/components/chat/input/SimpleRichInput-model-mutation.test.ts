import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { Workspace } from '$shared/types';

const fixture = vi.hoisted(() => ({
  state: {} as Record<string, any>,
  dispatch: vi.fn(),
  setModel: vi.fn(),
  setEffort: vi.fn(),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => fixture.state, dispatch: fixture.dispatch });
});
vi.mock('$lib/client', () => ({
  appClient: { agents: { setReasoningEffort: fixture.setEffort } },
}));
vi.mock('$store/renderer/slices/model/model-utils', async () => {
  const { wireModelsToProviderModels } = await import('$shared/models/wire-model-info');
  const models = (providerId: string) =>
    wireModelsToProviderModels({
      providerId,
      models: [
        {
          id: 'shared-model',
          name: `${providerId} shared`,
          provider: providerId,
          effortLevels: providerId === 'codex' ? ['medium', 'max'] : ['low', 'high'],
        },
        {
          id: `${providerId}-only`,
          name: `${providerId} only`,
          provider: providerId,
          effortLevels: ['low', 'high'],
        },
      ],
    });
  return {
    getModelsForProvider: vi.fn(async (providerId: string) => models(providerId)),
    getModelsForProviderForLoadingState: vi.fn(async (providerId: string) => ({
      models: models(providerId),
    })),
  };
});
vi.mock('./TipTapEditor.svelte', async () => ({
  default: (await import('../__tests__/mocks/TipTapEditor.svelte')).default,
}));
vi.mock('./ContextPickerButton.svelte', async () => ({
  default: (await import('../__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$lib/components/patterns/notify', async () => ({
  ...(await vi.importActual('$lib/components/ui/toast/toast-countdown')),
  notify: { error: vi.fn(), info: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToSettings: vi.fn() }));

import { store } from '$store/renderer/store';
import {
  initialState as sessionInitial,
  agentSessionReducer,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  initialState as modelInitial,
  modelReducer,
} from '$store/renderer/slices/model/model-slice';
import {
  initialState as catalogInitial,
  providerCatalogLoaded,
  providerCatalogReducer,
} from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import {
  initialState as modelsInitial,
  providerModelsReducer,
} from '$store/renderer/slices/provider-models/provider-models-slice';
import { MOCK_PROVIDER_CATALOG } from '../../../../test/fixtures/provider-catalog.fixture';
import { registerMockIpcHandler, unregisterMockIpcHandler } from '$shared/ipc-mock-router';
import { AGENT_CHANNELS } from '$shared/ipc/channels';
import SimpleRichInput from './SimpleRichInput.svelte';

const workspace = { id: 'model-tests', path: '/tmp/model-tests', name: 'Models' } as Workspace;
const emitState = () => (store as typeof store & { emitState(): void }).emitState();
const session = () => fixture.state.agentSessions.byAgentId['agent-1'];
const modelRequest = (providerId: string, modelId: string) => ({
  agentId: 'agent-1',
  workspaceId: 'model-tests',
  providerId,
  modelId,
});

function mount(overrides: Record<string, unknown> = {}) {
  return render(SimpleRichInput, {
    props: {
      value: '',
      contextItems: [],
      workspace,
      agentId: 'agent-1',
      selectedModel: 'shared-model',
      requiresModelSwitchConfirmation: true,
      ...overrides,
    },
  });
}

function losePermission() {
  fixture.state.workspace.workspaces.map['model-tests'].myRole = 'collaborator';
  emitState();
}

async function pick(provider: string, label: string) {
  const trigger = document.querySelector(
    '[data-chat-input-primary-actions] [data-slot="dropdown-root"] button',
  )!;
  if (trigger.getAttribute('aria-expanded') !== 'true') await fireEvent.click(trigger);
  await fireEvent.click(
    await screen.findByRole('tab', { name: provider === 'codex' ? /Codex/ : /Auggie/ }),
  );
  await fireEvent.click(await screen.findByRole('option', { name: label, exact: true }));
  await tick();
}

async function confirm() {
  const dialog = await screen.findByRole('dialog');
  await fireEvent.click(
    within(dialog).getByRole('button', { name: 'Switch provider', exact: true }),
  );
  await tick();
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.state = {
    agentSessions: {
      ...sessionInitial,
      byAgentId: {
        'agent-1': {
          id: 'agent-1',
          workspaceId: 'model-tests',
          name: 'Agent',
          backendSessionId: null,
          status: 'idle',
          messages: [],
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
          provider: 'auggie',
          model: 'shared-model',
          reasoningEffort: 'high',
          metadata: { provider: 'auggie' },
        },
      },
    },
    model: { ...modelInitial, defaultProviderId: 'auggie' },
    providerCatalog: providerCatalogReducer(
      catalogInitial,
      providerCatalogLoaded(MOCK_PROVIDER_CATALOG),
    ),
    providerModels: modelsInitial,
    providerSettings: { enabledProviders: { auggie: true, codex: true } },
    agentAvailability: {
      hasCheckedOnce: true,
      providerStatusMap: { auggie: { available: true }, codex: { available: true } },
    },
    workspace: {
      hasLoaded: true,
      workspaces: createCollection('id', [{ ...workspace, myRole: 'owner' }]),
    },
    connections: { windowBackendId: 'local', hasReceivedList: true },
    guestSessions: {
      sessions: createCollection('id'),
      hasReceivedList: true,
      listUnavailable: false,
    },
    daemonHealth: { health: 'healthy', hostLocality: 'local', stats: { protocolVersion: '9.4' } },
    hardwareConsole: { pttRecording: false, voiceTranscribing: false },
    voiceSettings: { engine: 'daemon', provider: 'elevenlabs', keyConfigured: {} },
    skills: { byWorkspaceId: {} },
    multiPanelContext: { panels: [], selections: [] },
  };
  fixture.dispatch.mockImplementation((action) => {
    fixture.state.agentSessions = agentSessionReducer(fixture.state.agentSessions, action);
    fixture.state.model = modelReducer(fixture.state.model, action);
    fixture.state.providerModels = providerModelsReducer(fixture.state.providerModels, action);
    fixture.state.providerCatalog = providerCatalogReducer(fixture.state.providerCatalog, action);
    emitState();
    return action;
  });
  fixture.setModel.mockResolvedValue({ success: true, data: { success: true } });
  fixture.setEffort.mockResolvedValue({ success: true });
  registerMockIpcHandler(AGENT_CHANNELS.SET_MODEL, fixture.setModel);
});

afterEach(() => {
  cleanup();
  unregisterMockIpcHandler(AGENT_CHANNELS.SET_MODEL);
});

describe('real composer model mutation ownership', () => {
  it('confirms a different provider with the same bare model ID before any mutation', async () => {
    mount();
    await pick('codex', 'codex shared');
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('button', { name: 'Switch provider', exact: true }),
    ).toBeTruthy();
    expect(fixture.setModel).not.toHaveBeenCalled();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel', exact: true }));
    await tick();
    expect(fixture.setModel).not.toHaveBeenCalled();
    expect(session()).toMatchObject({
      provider: 'auggie',
      model: 'shared-model',
      reasoningEffort: 'high',
    });
  });

  it('sends exactly one operation through the real parent and picker for a provider change', async () => {
    mount({ requiresModelSwitchConfirmation: false });
    await pick('codex', 'codex only');
    await waitFor(() =>
      expect(session()).toMatchObject({ provider: 'codex', model: 'codex-only' }),
    );
    await tick();
    expect(fixture.setModel).toHaveBeenCalledExactlyOnceWith(modelRequest('codex', 'codex-only'));
    expect(session().reasoningEffort).toBe('high');
  });

  it('confirms the provider identity for a different bare model ID', async () => {
    mount();
    await pick('codex', 'codex only');
    expect(fixture.setModel).not.toHaveBeenCalled();
    await confirm();
    await waitFor(() =>
      expect(fixture.setModel).toHaveBeenCalledExactlyOnceWith(modelRequest('codex', 'codex-only')),
    );
  });

  it('cancels a different-model provider change without writing', async () => {
    mount();
    await pick('codex', 'codex only');
    const dialog = await screen.findByRole('dialog');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel', exact: true }));
    await tick();
    expect(fixture.setModel).not.toHaveBeenCalled();
    expect(session()).toMatchObject({ provider: 'auggie', model: 'shared-model' });
  });

  it('confirms the same-ID provider choice once and uses its nearest supported effort', async () => {
    mount();
    await pick('codex', 'codex shared');
    await confirm();
    await waitFor(() =>
      expect(session()).toMatchObject({
        provider: 'codex',
        model: 'shared-model',
        reasoningEffort: 'medium',
      }),
    );
    expect(fixture.setModel).toHaveBeenCalledExactlyOnceWith(modelRequest('codex', 'shared-model'));
    expect(fixture.setEffort).toHaveBeenCalledExactlyOnceWith({
      agentId: 'agent-1',
      workspaceId: 'model-tests',
      reasoningEffort: 'medium',
    });
  });

  it('replaces deferred picks and sends only the last complete provider/model pair', async () => {
    const view = mount({ isStreaming: true, requiresModelSwitchConfirmation: false });
    await pick('codex', 'codex only');
    await pick('codex', 'codex shared');
    expect(fixture.setModel).not.toHaveBeenCalled();
    await view.rerender({ isStreaming: false });
    await waitFor(() =>
      expect(session()).toMatchObject({
        provider: 'codex',
        model: 'shared-model',
        reasoningEffort: 'medium',
      }),
    );
    expect(fixture.setModel).toHaveBeenCalledExactlyOnceWith(modelRequest('codex', 'shared-model'));
  });

  it('drops a deferred provider change when permission is lost', async () => {
    const view = mount({ isStreaming: true, requiresModelSwitchConfirmation: false });
    await pick('codex', 'codex only');
    losePermission();
    await view.rerender({ isStreaming: false });
    await tick();
    expect(fixture.setModel).not.toHaveBeenCalled();
    expect(fixture.setEffort).not.toHaveBeenCalled();
    expect(session()).toMatchObject({
      provider: 'auggie',
      model: 'shared-model',
      reasoningEffort: 'high',
    });
  });

  it('rechecks permission after confirmation', async () => {
    mount();
    await pick('codex', 'codex only');
    losePermission();
    const dialog = await screen.findByRole('dialog');
    await fireEvent.click(
      within(dialog).getByRole('button', { name: /^Switch (provider|model)$/ }),
    );
    await tick();
    expect(fixture.setModel).not.toHaveBeenCalled();
    expect(session()).toMatchObject({ provider: 'auggie', model: 'shared-model' });
  });

  it('restores the original selection on failure and permits a later successful edit', async () => {
    fixture.setModel.mockResolvedValueOnce({ success: false, error: 'Provider rejected model' });
    mount({ requiresModelSwitchConfirmation: false });
    await pick('codex', 'codex only');
    const { notify } = await import('$lib/components/patterns/notify');
    await waitFor(() => expect(notify.error).toHaveBeenCalled());
    expect(session()).toMatchObject({
      provider: 'auggie',
      model: 'shared-model',
      reasoningEffort: 'high',
    });
    expect(fixture.setModel).toHaveBeenCalledTimes(1);
    await pick('codex', 'codex shared');
    await waitFor(() =>
      expect(session()).toMatchObject({
        provider: 'codex',
        model: 'shared-model',
        reasoningEffort: 'medium',
      }),
    );
    expect(fixture.setModel).toHaveBeenCalledTimes(2);
    expect(fixture.setModel).toHaveBeenLastCalledWith(modelRequest('codex', 'shared-model'));
  });

  it('keeps an in-flight choice stable, then permits the next edit', async () => {
    let finish!: (value: unknown) => void;
    fixture.setModel.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mount({ requiresModelSwitchConfirmation: false });
    await pick('codex', 'codex only');
    await waitFor(() => expect(fixture.setModel).toHaveBeenCalled());
    await pick('auggie', 'auggie only');
    finish({ success: true, data: { success: true } });
    await waitFor(() =>
      expect(session()).toMatchObject({ provider: 'codex', model: 'codex-only' }),
    );
    expect(fixture.setModel).toHaveBeenCalledTimes(1);
    await pick('auggie', 'auggie only');
    await waitFor(() =>
      expect(session()).toMatchObject({ provider: 'auggie', model: 'auggie-only' }),
    );
    expect(fixture.setModel).toHaveBeenCalledTimes(2);
  });

  it('does not send effort or session writes after in-flight permission loss', async () => {
    let finish!: (value: unknown) => void;
    fixture.setModel.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mount({ requiresModelSwitchConfirmation: false });
    await pick('codex', 'codex shared');
    await waitFor(() => expect(fixture.setModel).toHaveBeenCalled());
    losePermission();
    const before = session();
    finish({ success: true, data: { success: true } });
    await tick();
    expect(fixture.setEffort).not.toHaveBeenCalled();
    expect(session()).toBe(before);
    expect(fixture.setModel).toHaveBeenCalledTimes(1);
  });

  it('prevents a queued effort reconciliation from reaching the wire after permission loss', async () => {
    const { applyReasoningEffort } = await import('$features/agent/reasoning-effort');
    let finish!: (value: { success: boolean }) => void;
    fixture.setEffort.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const existingWrite = applyReasoningEffort('agent-1', 'model-tests', 'low', 'high');
    await waitFor(() => expect(fixture.setEffort).toHaveBeenCalledTimes(1));
    mount({ requiresModelSwitchConfirmation: false });
    await pick('codex', 'codex shared');
    await waitFor(() =>
      expect(session()).toMatchObject({ provider: 'codex', reasoningEffort: 'medium' }),
    );
    losePermission();
    finish({ success: true });
    await existingWrite;
    await tick();
    expect(fixture.setEffort).toHaveBeenCalledTimes(1);
    expect(fixture.setModel).toHaveBeenCalledExactlyOnceWith(modelRequest('codex', 'shared-model'));
  });

  it('keeps an accepted model when effort reconciliation is rejected', async () => {
    fixture.setEffort.mockResolvedValueOnce({ success: false, error: 'Effort rejected' });
    mount({ requiresModelSwitchConfirmation: false });
    await pick('codex', 'codex shared');
    const { notify } = await import('$lib/components/patterns/notify');
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('Effort rejected'));
    expect(session()).toMatchObject({
      provider: 'codex',
      model: 'shared-model',
      reasoningEffort: 'high',
    });
    expect(fixture.setModel).toHaveBeenCalledExactlyOnceWith(modelRequest('codex', 'shared-model'));
  });

  it('does not publish a model completion after the composer is destroyed', async () => {
    let finish!: (value: unknown) => void;
    fixture.setModel.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = mount({ requiresModelSwitchConfirmation: false });
    await pick('codex', 'codex shared');
    await waitFor(() => expect(fixture.setModel).toHaveBeenCalledTimes(1));
    view.unmount();
    finish({ success: true, data: { success: true } });
    await tick();
    expect(session()).toMatchObject({
      provider: 'auggie',
      model: 'shared-model',
      reasoningEffort: 'high',
    });
    expect(fixture.setEffort).not.toHaveBeenCalled();
  });

  it('retains the accepted model if the effort transport throws', async () => {
    fixture.setEffort.mockRejectedValueOnce(new Error('Effort transport failed'));
    mount({ requiresModelSwitchConfirmation: false });
    await pick('codex', 'codex shared');
    const { notify } = await import('$lib/components/patterns/notify');
    await waitFor(() => expect(notify.error).toHaveBeenCalled());
    const trigger = document.querySelector(
      '[data-chat-input-primary-actions] [data-slot="dropdown-root"] button',
    )!;
    expect(trigger.textContent).toContain('codex shared');
    expect(session()).toMatchObject({ provider: 'codex', model: 'shared-model' });
    expect(fixture.setModel).toHaveBeenCalledExactlyOnceWith(modelRequest('codex', 'shared-model'));
  });

  it('shows the new provider effort choices when the global catalog has the same bare ID', async () => {
    fixture.state.model.availableModelsProviderId = 'auggie';
    fixture.state.model.availableModels = createCollection('value', [
      {
        value: 'shared-model',
        label: 'auggie shared',
        effortLevels: ['low', 'high'],
      },
    ]);
    mount({ requiresModelSwitchConfirmation: false });
    await pick('codex', 'codex shared');
    await waitFor(() => expect(session().reasoningEffort).toBe('medium'));
    await waitFor(() =>
      expect((screen.getByTestId('effort-picker-trigger') as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    await fireEvent.click(screen.getByTestId('effort-picker-trigger'));
    const menu = (await screen.findAllByRole('listbox')).at(-1)!;
    expect(within(menu).getByRole('option', { name: 'Max', exact: true })).toBeTruthy();
    expect(within(menu).queryByRole('option', { name: 'High', exact: true })).toBeNull();
  });
});

// Protocol-shaped fixture coverage for the additive legacyAliases contract.
// The daemon prerequisite owns resolver/catalog integration against its real registry.
describe('real composer authoritative provider identity', () => {
  const aliases = ['acp', 'default', 'augment'];
  const sources = ['explicit', 'metadata', 'config', 'compound', 'auto'] as const;
  function catalogWithAliases(target: string | undefined) {
    return {
      providers: [...MOCK_PROVIDER_CATALOG.providers]
        .reverse()
        .map(({ legacyAliases: _aliases, ...row }) => ({
          ...row,
          ...(row.id === target ? { legacyAliases: aliases } : {}),
        })),
    };
  }
  function setIdentity(alias: string, source: (typeof sources)[number]) {
    Object.assign(session(), { provider: undefined, metadata: {}, model: 'shared-model' });
    if (source === 'metadata') session().metadata = { provider: alias };
    else if (source === 'config') session().config = { provider: alias };
    else if (source === 'compound') session().model = `${alias}:shared-model`;
    else session().provider = alias;
    if (source === 'auto') session().model = null;
  }
  function trigger() {
    return document.querySelector(
      '[data-chat-input-primary-actions] [data-slot="dropdown-root"] button',
    ) as HTMLButtonElement;
  }

  for (const alias of aliases) {
    for (const source of sources) {
      for (const [target, configuredDefault, defaultEnabled] of [
        ['auggie', 'codex', true],
        ['auggie', 'codex', false],
        ['codex', 'auggie', false],
      ] as const) {
        it(`${alias} in ${source} resolves to ${target} with ${configuredDefault} default enabled=${defaultEnabled}`, async () => {
          fixture.state.providerCatalog = providerCatalogReducer(
            catalogInitial,
            providerCatalogLoaded(catalogWithAliases(target)),
          );
          fixture.state.model.defaultProviderId = configuredDefault;
          fixture.state.model.providerModels = { [target]: 'shared-model' };
          fixture.state.providerSettings.enabledProviders[configuredDefault] = defaultEnabled;
          setIdentity(alias, source);
          session().reasoningEffort = target === 'codex' ? 'medium' : 'high';
          const original = structuredClone(session());
          mount({ selectedModel: session().model });
          const expected = source === 'auto' ? 'Default model' : `${target} shared`;
          await waitFor(() => expect(trigger().textContent).toContain(expected));
          await fireEvent.click(trigger());
          const tab = await screen.findByRole('tab', {
            name: target === 'codex' ? /Codex/ : /Auggie/,
          });
          await waitFor(() => expect(tab.getAttribute('aria-selected')).toBe('true'));
          expect((await screen.findByTestId('effort-picker-trigger')).textContent).toContain(
            target === 'codex' ? 'Medium' : 'High',
          );
          const titles = [...document.querySelectorAll('[title]')]
            .map((element) => element.getAttribute('title'))
            .join(' ');
          expect(titles).not.toMatch(/is disabled in Settings/);
          expect(session()).toEqual(original);
          expect(fixture.setModel).not.toHaveBeenCalled();
          expect(fixture.setEffort).not.toHaveBeenCalled();
        });
      }
    }
    it(`${alias} keeps same-ID provider confirmation, Cancel and one Confirm operation`, async () => {
      setIdentity(alias, 'explicit');
      mount();
      await pick('codex', 'codex shared');
      let dialog = await screen.findByRole('dialog');
      expect(dialog.textContent).toContain('Augment Auggie');
      expect(dialog.textContent).toContain('OpenAI Codex');
      await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel', exact: true }));
      expect(fixture.setModel).not.toHaveBeenCalled();
      await pick('codex', 'codex shared');
      await confirm();
      await waitFor(() =>
        expect(session()).toMatchObject({
          provider: 'codex',
          model: 'shared-model',
          reasoningEffort: 'medium',
        }),
      );
      expect(fixture.setModel).toHaveBeenCalledExactlyOnceWith(
        modelRequest('codex', 'shared-model'),
      );
    });
  }

  it.each([...aliases, 'future-provider'])(
    'preserves unresolved %s on an older daemon until an explicit canonical choice',
    async (raw) => {
      fixture.state.providerCatalog = providerCatalogReducer(
        catalogInitial,
        providerCatalogLoaded(catalogWithAliases(undefined)),
      );
      setIdentity(raw, 'explicit');
      session().effortLevels = ['low', 'high'];
      mount();
      await fireEvent.click(trigger());
      await screen.findByRole('tab', { name: /Codex/ });
      await waitFor(() => expect(trigger().textContent).toContain('shared-model'));
      expect(trigger().textContent).not.toContain('auggie shared');
      const effort = screen.getByTestId('effort-picker-trigger') as HTMLButtonElement;
      expect(effort.disabled).toBe(true);
      await fireEvent.click(effort);
      expect(fixture.setModel).not.toHaveBeenCalled();
      expect(fixture.setEffort).not.toHaveBeenCalled();
      await pick('codex', 'codex shared');
      await confirm();
      await waitFor(() =>
        expect(session()).toMatchObject({
          provider: 'codex',
          model: 'shared-model',
          reasoningEffort: 'medium',
        }),
      );
      expect(fixture.setModel).toHaveBeenCalledExactlyOnceWith(
        modelRequest('codex', 'shared-model'),
      );
    },
  );

  it('resolves a retained raw identity when the catalog arrives without issuing a mutation', async () => {
    fixture.state.providerCatalog = catalogInitial;
    setIdentity('acp', 'metadata');
    mount();
    await tick();
    expect(fixture.setModel).not.toHaveBeenCalled();
    fixture.dispatch(providerCatalogLoaded(catalogWithAliases('auggie')));
    await waitFor(() => expect(trigger().textContent).toContain('auggie shared'));
    expect(session().metadata.provider).toBe('acp');
    expect(fixture.setModel).not.toHaveBeenCalled();
    expect(fixture.setEffort).not.toHaveBeenCalled();
  });
});
