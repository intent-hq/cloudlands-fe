import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
const { update } = vi.hoisted(() => ({
  update: vi.fn(async () => ({ applied: [], revision: 2 })),
}));
vi.mock('$lib/client', () => ({ appClient: { settings: { get: vi.fn(), update } } }));
import { store } from '$store/renderer/store';
import { preview } from '$lib/components/chat/input/model-picker.preview';
import ModelPicker from '$lib/components/chat/input/ModelPicker.svelte';
import DefaultAgentModelSettings from '$lib/components/settings/DefaultAgentModelSettings.svelte';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import { modelSelectionSaga } from '$store/renderer/slices/model/sagas/model-selection-saga';
import { backgroundAgentSettingsSaga } from '$store/renderer/slices/background-agent-settings/sagas/background-agent-settings-saga';
import { providerSettingsSaga } from '$store/renderer/slices/provider-settings/sagas/provider-settings-saga';
const disposers: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const stop of disposers.splice(0).reverse()) stop();
  vi.resetAllMocks();
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
