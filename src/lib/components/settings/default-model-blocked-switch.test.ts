import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
const { update, list } = vi.hoisted(() => ({
  update:
    vi.fn<
      (
        changes: import('$lib/client/app-client').AppSettingChange[],
      ) => Promise<import('$lib/client/app-client').AppliedSettingChange[]>
    >(),
  list: vi.fn(),
}));
vi.mock('$lib/client', () => ({ appClient: { settings: { get: vi.fn(), update, list } } }));
import { store } from '$store/renderer/store';
import { preview } from '$lib/components/chat/input/model-picker.preview';
import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
import DefaultAgentModelSettings from '$lib/components/settings/DefaultAgentModelSettings.svelte';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import { modelSelectionSaga } from '$store/renderer/slices/model/sagas/model-selection-saga';
import { backgroundAgentSettingsSaga } from '$store/renderer/slices/background-agent-settings/sagas/background-agent-settings-saga';
import { providerSettingsSaga } from '$store/renderer/slices/provider-settings/sagas/provider-settings-saga';
import { providerModelsLoaded } from '$store/renderer/slices/provider-models/provider-models-slice';
import { selectModel } from '$store/renderer/slices/model/model-slice';
const disposers: Array<() => void> = [];
beforeEach(() => {
  const saved = new Map<string, unknown>([
    ['model.defaultProvider', 'codex'],
    ['model.providerDefaults', { codex: 'codex-preview-balanced' }],
    ['quickActions.defaultModel', ''],
    ['quickActions.typeOverrides', { commit: '', pr: '', review: '', fast: '' }],
    ['quickActions.defaultReasoningEffort', ''],
    ['quickActions.typeReasoningEffortOverrides', {}],
    ['quickActions.providerSettings', {}],
  ]);
  list.mockImplementation(async () => [...saved].map(([path, value]) => ({ path, value })));
  update.mockImplementation(async (changes) => {
    for (const { path, value } of changes) saved.set(path, value);
    return changes;
  });
});
afterEach(() => {
  cleanup();
  for (const stop of disposers.splice(0).reverse()) stop();
  vi.resetAllMocks();
});

it('keeps the open Default picker on Redux authority until a daemon event arrives', async () => {
  disposers.push(store.init());
  const restore = preview.states.reasoning.setup?.();
  if (restore) disposers.push(restore);
  applySettingsChanges([
    { path: 'model.defaultProvider', value: 'codex' },
    { path: 'model.providerDefaults', value: { codex: 'codex-preview-balanced' } },
  ]);
  let acknowledge!: () => void;
  update.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => (acknowledge = resolve));
    return [];
  });
  disposers.push(store.runSaga(providerSettingsSaga));
  disposers.push(store.runSaga(modelSelectionSaga));
  const root = render(DefaultAgentModelSettings, { workspaceId: null });
  const trigger = root.container.querySelector('button[aria-haspopup="listbox"]')!;
  await fireEvent.click(trigger);
  const fast = await screen.findByRole('option', { name: /Fast/ });
  await fireEvent.click(fast);
  await waitFor(() =>
    expect(update).toHaveBeenCalledExactlyOnceWith([
      { path: 'model.defaultProvider', value: 'codex' },
      { path: 'model.providerDefaults', value: { codex: 'codex-preview-fast' } },
    ]),
  );
  expect(store.state.model.providerModels.codex).toBe('codex-preview-balanced');
  expect(trigger.textContent).toContain('Balanced');
  expect(fast.getAttribute('aria-selected')).toBe('false');
  acknowledge();
  await tick();
  expect(trigger.textContent).toContain('Balanced');
  applySettingsChanges([
    { path: 'model.providerDefaults', value: { codex: 'codex-preview-fast' } },
  ]);
  await waitFor(() => expect(trigger.textContent).toContain('Fast'));
  expect(fast.getAttribute('aria-selected')).toBe('true');
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
});

for (const withCallbacks of [false, true]) {
  it(`preserves ordinary effort and picker selection when legacy snapshot blocks model switch (callbacks ${withCallbacks})`, async () => {
    disposers.push(store.init());
    const restore = preview.states.reasoning.setup?.();
    if (restore) disposers.push(restore);
    disposers.push(store.runSaga(backgroundAgentSettingsSaga));
    disposers.push(store.runSaga(providerSettingsSaga));
    applySettingsChanges([
      { path: 'model.defaultProvider', value: 'codex' },
      { path: 'model.providerDefaults', value: { codex: 'codex-preview-balanced' } },
      { path: 'model.defaultReasoningEffort', value: 'medium' },
      { path: 'quickActions.defaultModel', value: 'balanced' },
      { path: 'quickActions.defaultReasoningEffort', value: 'low' },
      {
        path: 'quickActions.providerSettings',
        value: {
          'claude-code': {
            defaultModel: 'codex:foreign-model',
            typeOverrides: { commit: '', pr: '', review: '', fast: '' },
            defaultReasoningEffort: 'medium',
          },
        },
      },
    ]);
    disposers.push(store.runSaga(modelSelectionSaga));
    const onModelChange = vi.fn();
    const onReasoningChange = vi.fn();
    const root = withCallbacks
      ? render(ModelPicker, {
          selectedModel: 'codex-preview-balanced',
          selectedModelProviderId: 'codex',
          updateGlobalDefault: true,
          showDefaultOption: false,
          showReasoning: true,
          reasoningEffort: 'medium',
          onModelChange,
          onReasoningChange,
        })
      : render(DefaultAgentModelSettings, { workspaceId: null });
    const trigger = root.container.querySelector('button[aria-haspopup="listbox"]')!;
    await fireEvent.click(trigger);
    await fireEvent.click(await screen.findByRole('tab', { name: 'Claude Code' }));
    await fireEvent.click(await screen.findByRole('option', { name: /Deep/ }));
    await tick();
    await waitFor(() => expect(store.state.model.defaultProviderId).toBe('codex'));
    expect(store.state.model.defaultReasoningEffort).toBe('medium');
    expect(update).not.toHaveBeenCalled();
    expect(trigger.textContent).toContain('Balanced');
    expect(onModelChange).not.toHaveBeenCalled();
    expect(onReasoningChange).not.toHaveBeenCalled();
  });
}

it.each(['accept', 'reject'] as const)(
  'waits for daemon state while persistence can %s',
  async (outcome) => {
    disposers.push(store.init());
    const restore = preview.states.reasoning.setup?.();
    if (restore) disposers.push(restore);
    applySettingsChanges([
      { path: 'model.defaultProvider', value: 'codex' },
      { path: 'model.providerDefaults', value: { codex: 'codex-preview-balanced' } },
      { path: 'model.defaultReasoningEffort', value: '' },
    ]);
    let release!: () => void;
    let settled = false;
    update.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      settled = true;
      if (outcome === 'reject')
        throw Object.assign(new Error('Model rejected'), { rpcCode: -32602 });
      return [];
    });
    disposers.push(store.runSaga(providerSettingsSaga));
    disposers.push(store.runSaga(modelSelectionSaga));
    const root = render(DefaultAgentModelSettings, { workspaceId: null });
    const trigger = root.container.querySelector('button[aria-haspopup="listbox"]')!;
    await fireEvent.click(trigger);
    const fast = await screen.findByRole('option', { name: /Fast/ });
    fast.click();
    expect(store.state.model.defaultProviderId).toBe('codex');
    expect(store.state.model.providerModels.codex).toBe('codex-preview-balanced');
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(trigger.textContent).toContain('Balanced');
    expect(fast.getAttribute('aria-selected')).toBe('false');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(update).toHaveBeenCalledExactlyOnceWith([
      { path: 'model.defaultProvider', value: 'codex' },
      { path: 'model.providerDefaults', value: { codex: 'codex-preview-fast' } },
    ]);
    expect(settled).toBe(false);
    release();
    await waitFor(() => expect(settled).toBe(true));
    expect(trigger.textContent).toContain('Balanced');
    applySettingsChanges([
      {
        path: 'model.providerDefaults',
        value: {
          codex: outcome === 'accept' ? 'codex-preview-fast' : 'codex-preview-balanced',
        },
      },
    ]);
    await waitFor(() =>
      expect(trigger.textContent).toContain(outcome === 'accept' ? 'Fast' : 'Balanced'),
    );
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  },
);

it.each(['accept', 'reject'] as const)(
  'renders the Redux %s outcome in Default model settings before the selector closes',
  async (outcome) => {
    disposers.push(store.init());
    const restore = preview.states.reasoning.setup?.();
    if (restore) disposers.push(restore);
    applySettingsChanges([
      { path: 'model.defaultProvider', value: 'codex' },
      { path: 'model.providerDefaults', value: { codex: 'codex-preview-balanced' } },
      { path: 'model.defaultReasoningEffort', value: '' },
    ]);
    if (outcome === 'reject') {
      update.mockRejectedValueOnce(Object.assign(new Error('Model rejected'), { rpcCode: -32602 }));
    }
    disposers.push(store.runSaga(providerSettingsSaga));
    disposers.push(store.runSaga(modelSelectionSaga));
    const root = render(DefaultAgentModelSettings, { workspaceId: null });
    const trigger = root.container.querySelector('button[aria-haspopup="listbox"]')!;
    await fireEvent.click(trigger);
    await fireEvent.click(await screen.findByRole('option', { name: /Fast/ }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith([
        { path: 'model.defaultProvider', value: 'codex' },
        { path: 'model.providerDefaults', value: { codex: 'codex-preview-fast' } },
      ]),
    );
    const model = outcome === 'accept' ? 'codex-preview-fast' : 'codex-preview-balanced';
    expect(store.state.model.providerModels.codex).toBe('codex-preview-balanced');
    applySettingsChanges([{ path: 'model.providerDefaults', value: { codex: model } }]);
    await waitFor(() => expect(store.state.model.providerModels.codex).toBe(model));
    await waitFor(() =>
      expect(trigger.textContent).toContain(outcome === 'accept' ? 'Fast' : 'Balanced'),
    );
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() =>
      expect(
        screen
          .getByRole('option', { name: outcome === 'accept' ? /Fast/ : /Balanced/ })
          .getAttribute('aria-selected'),
      ).toBe('true'),
    );
  },
);

it('renders each daemon event while multiple Default picks are queued and Settings stays open', async () => {
  disposers.push(store.init());
  const restore = preview.states.reasoning.setup?.();
  if (restore) disposers.push(restore);
  applySettingsChanges(
    [
      { path: 'model.defaultProvider', value: 'codex' },
      { path: 'model.providerDefaults', value: { codex: 'codex-preview-balanced' } },
      { path: 'model.defaultReasoningEffort', value: '' },
    ],
    5,
  );
  let finishFirst!: (result: []) => void;
  let finishSecond!: (result: []) => void;
  const write = update
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSecond = resolve;
        }),
    );
  disposers.push(store.runSaga(providerSettingsSaga));
  disposers.push(store.runSaga(modelSelectionSaga));
  const root = render(DefaultAgentModelSettings, { workspaceId: null });
  const trigger = root.container.querySelector('button[aria-haspopup="listbox"]')!;
  await fireEvent.click(trigger);
  await fireEvent.click(await screen.findByRole('option', { name: /Fast/ }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  await fireEvent.click(await screen.findByRole('option', { name: /Balanced/ }));
  await waitFor(() => expect(trigger.textContent).toContain('Balanced'));
  applySettingsChanges(
    [
      { path: 'model.defaultProvider', value: 'codex' },
      { path: 'model.providerDefaults', value: { codex: 'codex-preview-fast' } },
    ],
    6,
  );
  await waitFor(() => expect(trigger.textContent).toContain('Fast'));
  expect(store.state.model.providerModels.codex).toBe('codex-preview-fast');
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  finishFirst([]);
  await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  expect(trigger.textContent).toContain('Fast');
  finishSecond([]);
  await tick();
  expect(store.state.model.providerModels.codex).toBe('codex-preview-fast');
  applySettingsChanges(
    [{ path: 'model.providerDefaults', value: { codex: 'codex-preview-balanced' } }],
    7,
  );
  await waitFor(() => expect(trigger.textContent).toContain('Balanced'));
  expect(screen.getByRole('option', { name: /Balanced/ }).getAttribute('aria-selected')).toBe(
    'true',
  );
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(write.mock.calls).toEqual([
    [
      [
        { path: 'model.defaultProvider', value: 'codex' },
        { path: 'model.providerDefaults', value: { codex: 'codex-preview-fast' } },
      ],
    ],
    [
      [
        { path: 'model.defaultProvider', value: 'codex' },
        { path: 'model.providerDefaults', value: { codex: 'codex-preview-balanced' } },
      ],
    ],
  ]);
});

it('follows the accepted Redux provider for the same bare default model while Settings stays open', async () => {
  disposers.push(store.init());
  const restore = preview.states.reasoning.setup?.();
  if (restore) disposers.push(restore);
  for (const providerId of ['codex', 'claude-code']) {
    store.dispatch(
      providerModelsLoaded(
        providerId,
        { models: [{ value: 'shared', label: `${providerId} shared` }] },
        store.state.providerModels.clearEpoch,
      ),
    );
  }
  applySettingsChanges([
    { path: 'model.defaultProvider', value: 'codex' },
    { path: 'model.providerDefaults', value: { codex: 'codex-preview-balanced' } },
    { path: 'model.defaultReasoningEffort', value: '' },
  ]);
  disposers.push(store.runSaga(providerSettingsSaga));
  disposers.push(store.runSaga(modelSelectionSaga));
  const root = render(DefaultAgentModelSettings, { workspaceId: null });
  const trigger = root.container.querySelector('button[aria-haspopup="listbox"]')!;
  await fireEvent.click(trigger);
  await fireEvent.click(await screen.findByRole('option', { name: 'codex shared' }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  applySettingsChanges([{ path: 'model.providerDefaults', value: { codex: 'shared' } }]);
  await waitFor(() => expect(trigger.textContent).toContain('codex shared'));
  store.dispatch(selectModel('shared', 'claude-code'));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  applySettingsChanges([
    { path: 'model.defaultProvider', value: 'claude-code' },
    { path: 'model.providerDefaults', value: { codex: 'shared', 'claude-code': 'shared' } },
  ]);
  await waitFor(() => expect(store.state.model.defaultProviderId).toBe('claude-code'));
  await waitFor(() => expect(trigger.textContent).toContain('claude-code shared'));
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(update).toHaveBeenLastCalledWith([
    { path: 'model.defaultProvider', value: 'claude-code' },
    { path: 'model.providerDefaults', value: { codex: 'shared', 'claude-code': 'shared' } },
    { path: 'quickActions.defaultModel', value: '' },
    { path: 'quickActions.typeOverrides', value: { commit: '', pr: '', review: '', fast: '' } },
    { path: 'quickActions.defaultReasoningEffort', value: '' },
    { path: 'quickActions.typeReasoningEffortOverrides', value: {} },
    {
      path: 'quickActions.providerSettings',
      value: {
        codex: {
          defaultModel: '',
          defaultReasoningEffort: '',
          typeOverrides: { commit: '', pr: '', review: '', fast: '' },
          typeReasoningEffortOverrides: {},
        },
      },
    },
  ]);
});
