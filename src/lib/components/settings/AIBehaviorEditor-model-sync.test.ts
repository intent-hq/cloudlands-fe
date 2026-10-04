import { admitLegacyPrincipal } from '../../../test/fixtures/principal-state';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { SpecialistDef } from '$lib/client/app-client';
import { store } from '$store/renderer/store';
import { specialistsSaga } from '$store/renderer/slices/specialists/sagas/specialists-saga';
import { workspaceCatalogReceived } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import { providerModelsLoaded } from '$store/renderer/slices/provider-models/provider-models-slice';
import { WorkspaceId } from '$shared/types/branded-ids';
import { MOCK_PROVIDER_CATALOG } from '../../../test/fixtures/provider-catalog.fixture';
import { preview } from '../chat/input/model-picker.preview';
import AIBehaviorEditor from './AIBehaviorEditor.svelte';

const transport = vi.hoisted(() => ({ request: vi.fn(), notifyError: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: transport.request,
  backendSubscribe: vi.fn(async () => ({ subscriptionId: 'specialist-test' })),
  backendUnsubscribe: vi.fn(async () => {}),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', async () => {
  const { LiveSpecialistsClient } = await import('$lib/client/live/live-specialists-client');
  return { appClient: { specialists: new LiveSpecialistsClient() } };
});
vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: transport.notifyError } }));

const disposers: Array<() => void> = [];
const initial: SpecialistDef = {
  id: 'chief-of-staff',
  name: 'Assistant',
  description: 'App-level assistant',
  codingAgent: 'codex',
  model: 'codex-preview-balanced',
  reasoningEffort: 'medium',
  behaviorPrompt: 'Help with settings.',
  source: 'user',
  hidden: true,
  icon: 'chief-of-staff',
  path: '/test/specialists/chief-of-staff.md',
  isCustomized: true,
  resolvedProvider: 'codex',
  resolvedModel: 'codex-preview-balanced',
};

function publishWorkspace(def: SpecialistDef) {
  store.dispatch(
    workspaceCatalogReceived(
      'workspace-a',
      { catalog: MOCK_PROVIDER_CATALOG, readiness: {}, settings: [], specialists: [def] },
      store.state.providerCatalog.workspaceEpoch ?? 0,
    ),
  );
}

async function setup(def = initial, workspaceDef = def) {
  disposers.push(store.init());
  admitLegacyPrincipal();
  const restore = preview.states.reasoning.setup?.();
  if (restore) disposers.push(restore);
  let saved = def;
  let accept!: (value: { specialist: SpecialistDef }) => void;
  let reject!: (error: Error) => void;
  transport.request.mockImplementation((method: string) => {
    if (method === 'specialist.list') return Promise.resolve({ specialists: [saved] });
    if (method === 'specialist.edit')
      return new Promise((resolve, rejectSave) => {
        accept = resolve;
        reject = rejectSave;
      });
    throw new Error(`Unexpected request: ${method}`);
  });
  disposers.push(store.runSaga(specialistsSaga));
  await waitFor(() => expect(store.state.specialists.fileSpecialists.map[def.id]).toBeDefined());
  publishWorkspace(workspaceDef);
  const root = render(AIBehaviorEditor, {
    activeView: { type: 'specialist', id: def.id },
    workspaceId: WorkspaceId('workspace-a'),
  });
  await tick();
  return {
    root,
    acknowledge(next: SpecialistDef) {
      saved = next;
      accept({ specialist: next });
    },
    reject: (error: Error) => reject(error),
  };
}

afterEach(() => {
  cleanup();
  for (const stop of disposers.splice(0).reverse()) stop();
  vi.clearAllMocks();
});

it('retains the acknowledged model in the open editor while its workspace catalog is stale', async () => {
  const harness = await setup();
  const trigger = harness.root.container.querySelector('button[aria-haspopup="listbox"]')!;
  await fireEvent.click(trigger);
  await fireEvent.click(await screen.findByRole('option', { name: /Fast/ }));
  await waitFor(() => expect(trigger.textContent).toContain('Fast'));
  expect(transport.request.mock.calls.filter(([method]) => method === 'specialist.edit')).toEqual([
    [
      'specialist.edit',
      {
        id: 'chief-of-staff',
        scope: 'user',
        spec: {
          id: 'chief-of-staff',
          name: 'Assistant',
          description: 'App-level assistant',
          codingAgent: 'codex',
          model: 'codex-preview-fast',
          behaviorPrompt: 'Help with settings.',
          source: 'user',
          hidden: true,
          icon: 'chief-of-staff',
        },
      },
    ],
  ]);
  const acknowledged = {
    ...initial,
    model: 'codex-preview-fast',
    resolvedModel: 'codex-preview-fast',
    reasoningEffort: undefined,
  };
  harness.acknowledge(acknowledged);
  await waitFor(() =>
    expect(store.state.specialists.fileSpecialists.map['chief-of-staff'].model).toBe(
      'codex-preview-fast',
    ),
  );
  await tick();
  expect(store.state.providerCatalog.byWorkspaceId?.['workspace-a'].specialists[0].model).toBe(
    'codex-preview-balanced',
  );
  expect(trigger.textContent).toContain('Fast');
  expect(screen.getByRole('option', { name: /Fast/ }).getAttribute('aria-selected')).toBe('true');
  expect(trigger.getAttribute('aria-expanded')).toBe('true');

  // A second selection must also stay visible without waiting for the first
  // workspace projection to catch up.
  await fireEvent.click(screen.getByRole('option', { name: /Deep/ }));
  const second = {
    ...acknowledged,
    model: 'codex-preview-deep',
    resolvedModel: 'codex-preview-deep',
  };
  harness.acknowledge(second);
  await waitFor(() =>
    expect(store.state.specialists.fileSpecialists.map['chief-of-staff'].model).toBe(
      'codex-preview-deep',
    ),
  );
  await tick();
  expect(trigger.textContent).toContain('Deep');
  expect(screen.getByRole('option', { name: /Deep/ }).getAttribute('aria-selected')).toBe('true');
  publishWorkspace(second);
  await tick();
  expect(trigger.textContent).toContain('Deep');
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
});

it('preserves provider identity when the acknowledged model has the same bare id', async () => {
  const shared = {
    ...initial,
    model: 'shared',
    resolvedModel: 'shared',
    reasoningEffort: undefined,
  };
  const harness = await setup(shared);
  for (const provider of ['codex', 'claude-code']) {
    store.dispatch(
      providerModelsLoaded(
        provider,
        {
          models: [{ value: 'shared', label: `${provider} shared` }],
        },
        store.state.providerModels.clearEpoch,
      ),
    );
  }
  await tick();
  const trigger = harness.root.container.querySelector('button[aria-haspopup="listbox"]')!;
  await fireEvent.click(trigger);
  await fireEvent.click(await screen.findByRole('tab', { name: 'Claude Code' }));
  await fireEvent.click(await screen.findByRole('option', { name: 'claude-code shared' }));
  expect(transport.request).toHaveBeenCalledWith('specialist.edit', {
    id: 'chief-of-staff',
    scope: 'user',
    spec: {
      id: 'chief-of-staff',
      name: 'Assistant',
      description: 'App-level assistant',
      codingAgent: 'claude-code',
      model: 'shared',
      behaviorPrompt: 'Help with settings.',
      source: 'user',
      hidden: true,
      icon: 'chief-of-staff',
    },
  });
  const acknowledged = { ...shared, codingAgent: 'claude-code', resolvedProvider: 'claude-code' };
  harness.acknowledge(acknowledged);
  await waitFor(() =>
    expect(store.state.specialists.fileSpecialists.map['chief-of-staff'].codingAgent).toBe(
      'claude-code',
    ),
  );
  await tick();
  expect(trigger.textContent).toContain('claude-code shared');
  expect(
    screen.getByRole('option', { name: 'claude-code shared' }).getAttribute('aria-selected'),
  ).toBe('true');
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  publishWorkspace(acknowledged);
  await tick();
  expect(trigger.textContent).toContain('claude-code shared');
});

it('keeps a project definition scoped instead of reading the same-id user definition', async () => {
  const project: SpecialistDef = {
    ...initial,
    source: 'project',
    model: 'codex-preview-deep',
    resolvedModel: 'codex-preview-deep',
    reasoningEffort: undefined,
    path: '/project/.intent/specialists/chief-of-staff.md',
  };
  const harness = await setup(initial, project);
  const trigger = harness.root.container.querySelector('button[aria-haspopup="listbox"]')!;
  // No workspace model catalog is loaded: the picker honestly renders the id.
  expect(trigger.textContent).toContain('codex-preview-deep');
  publishWorkspace({
    ...project,
    model: 'codex-preview-fast',
    resolvedModel: 'codex-preview-fast',
  });
  await waitFor(() => expect(trigger.textContent).toContain('codex-preview-fast'));
  expect(store.state.specialists.fileSpecialists.map['chief-of-staff'].model).toBe(
    'codex-preview-balanced',
  );
});

it('reports a rejected save without publishing it as an acknowledged specialist', async () => {
  const harness = await setup();
  const trigger = harness.root.container.querySelector('button[aria-haspopup="listbox"]')!;
  await fireEvent.click(trigger);
  await fireEvent.click(await screen.findByRole('option', { name: /Fast/ }));
  harness.reject(new Error('Specialist save rejected'));
  await waitFor(() =>
    expect(transport.notifyError).toHaveBeenCalledExactlyOnceWith('Specialist save rejected'),
  );
  expect(store.state.specialists.fileSpecialists.map['chief-of-staff'].model).toBe(
    'codex-preview-balanced',
  );
  expect(store.state.providerCatalog.byWorkspaceId?.['workspace-a'].specialists[0].model).toBe(
    'codex-preview-balanced',
  );

  await fireEvent.click(screen.getByRole('option', { name: /Deep/ }));
  harness.acknowledge({
    ...initial,
    model: 'codex-preview-deep',
    resolvedModel: 'codex-preview-deep',
    reasoningEffort: undefined,
  });
  await waitFor(() =>
    expect(store.state.specialists.fileSpecialists.map['chief-of-staff'].model).toBe(
      'codex-preview-deep',
    ),
  );
  await tick();
  expect(trigger.textContent).toContain('Deep');
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
});

it('keeps imported specialist editing read-only', async () => {
  const harness = await setup({ ...initial, importedFrom: 'claude-code' });
  expect(harness.root.container.querySelector('button[aria-haspopup="listbox"]')).toBeNull();
  expect(screen.getByRole('textbox').hasAttribute('readonly')).toBe(true);
  expect(transport.request.mock.calls.some(([method]) => method === 'specialist.edit')).toBe(false);
});

it('restores the creation provider, model and effort after an acknowledged edit and remount', async () => {
  const harness = await setup();
  const workspaceId = WorkspaceId('workspace-a');
  await harness.root.rerender({ activeView: { type: 'create-specialist' }, workspaceId });
  await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Retained draft' } });
  await fireEvent.input(screen.getByLabelText('Description'), {
    target: { value: 'Retained description' },
  });
  await fireEvent.input(document.getElementById('create-specialist-prompt')!, {
    target: { value: 'Retained prompt' },
  });
  let picker = harness.root.container.querySelector('button[aria-haspopup="listbox"]')!;
  await fireEvent.click(picker);
  await fireEvent.click(await screen.findByRole('tab', { name: 'Claude Code' }));
  await fireEvent.click(await screen.findByRole('option', { name: /Balanced/ }));
  await fireEvent.click(await screen.findByTestId('effort-picker-trigger'));
  const listboxes = await screen.findAllByRole('listbox');
  await fireEvent.pointerUp(
    within(listboxes[listboxes.length - 1]).getByRole('option', { name: 'High' }),
    { pointerType: 'mouse' },
  );
  await waitFor(() =>
    expect(
      store.state.specialists.creationByContext['workspace:workspace-a'].draft.reasoningEffort,
    ).toBe('high'),
  );
  const draft = structuredClone(
    store.state.specialists.creationByContext['workspace:workspace-a'].draft,
  );
  expect(draft).toMatchObject({
    name: 'Retained draft',
    description: 'Retained description',
    behaviorPrompt: 'Retained prompt',
    codingAgent: 'claude-code',
    reasoningEffort: 'high',
  });
  expect(draft.model).toContain('claude-code-preview-balanced');

  await harness.root.rerender({ activeView: { type: 'specialist', id: initial.id }, workspaceId });
  picker = harness.root.container.querySelector('button[aria-haspopup="listbox"]')!;
  await fireEvent.click(picker);
  await fireEvent.click(await screen.findByRole('option', { name: /Fast/ }));
  harness.acknowledge({
    ...initial,
    model: 'codex-preview-fast',
    resolvedModel: 'codex-preview-fast',
    reasoningEffort: undefined,
  });
  await waitFor(() =>
    expect(store.state.specialists.fileSpecialists.map[initial.id].model).toBe(
      'codex-preview-fast',
    ),
  );
  await tick();
  expect(picker.textContent).toContain('Fast');
  expect(store.state.providerCatalog.byWorkspaceId?.['workspace-a'].specialists[0].model).toBe(
    'codex-preview-balanced',
  );
  expect(store.state.specialists.creationByContext['workspace:workspace-a'].draft).toEqual(draft);

  async function expectRestoredDraft(container: HTMLElement) {
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(draft.name);
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe(
      draft.description,
    );
    expect((document.getElementById('create-specialist-prompt') as HTMLTextAreaElement).value).toBe(
      draft.behaviorPrompt,
    );
    expect(store.state.specialists.creationByContext['workspace:workspace-a'].draft).toEqual(draft);
    const trigger = container.querySelector('button[aria-haspopup="listbox"]')!;
    expect(trigger.textContent).toContain('Balanced');
    await fireEvent.click(trigger);
    expect(screen.getByRole('tab', { name: 'Claude Code' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('option', { name: /Balanced/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByTestId('effort-picker-trigger').textContent).toContain('High');
    await fireEvent.click(trigger);
  }

  await harness.root.rerender({ activeView: { type: 'create-specialist' }, workspaceId });
  await expectRestoredDraft(harness.root.container);
  harness.root.unmount();
  const remounted = render(AIBehaviorEditor, {
    activeView: { type: 'create-specialist' },
    workspaceId,
  });
  await tick();
  await expectRestoredDraft(remounted.container);
  await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  expect(store.state.specialists.creationByContext['workspace:workspace-a']).toBeUndefined();
  await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(''));
});
