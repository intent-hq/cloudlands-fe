import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
const { update, notifySuccess, notifyError } = vi.hoisted(() => ({
  update: vi.fn(async () => []),
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: { settings: { get: vi.fn(async () => ({ value: {} })), update } },
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: notifySuccess, error: notifyError },
}));
import { store } from '$store/renderer/store';
import { setupPreviewProviders } from '$lib/components/settings/provider-selector.preview';
import ProviderSelector from '$lib/components/settings/ProviderSelector.svelte';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import { providerSettingsSaga } from '$store/renderer/slices/provider-settings/sagas/provider-settings-saga';
import { backgroundAgentSettingsSaga } from '$store/renderer/slices/background-agent-settings/sagas/background-agent-settings-saga';
import { selectProviderSettingsSessionRequests } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
const disposers: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const stop of disposers.splice(0).reverse()) stop();
  vi.resetAllMocks();
});
it('does not announce a successful provider switch when the legacy snapshot rejects it', async () => {
  disposers.push(store.init(), setupPreviewProviders());
  disposers.push(store.runSaga(providerSettingsSaga), store.runSaga(backgroundAgentSettingsSaga));
  applySettingsChanges([
    { path: 'model.defaultProvider', value: 'codex' },
    { path: 'quickActions.defaultModel', value: 'balanced' },
    { path: 'quickActions.defaultReasoningEffort', value: 'low' },
    {
      path: 'quickActions.providerSettings',
      value: {
        'claude-code': {
          defaultModel: 'codex:foreign-model',
          typeOverrides: {},
          defaultReasoningEffort: 'high',
        },
      },
    },
  ]);
  const before = store.state.backgroundAgentSettings;
  const dispatch = vi.spyOn(store, 'dispatch');
  render(ProviderSelector);
  const button = await screen.findByRole('button', { name: /Actions for Claude Code/i });
  await fireEvent.click(button);
  await fireEvent.click(await screen.findByRole('menuitem', { name: /Set as default/i }));
  await waitFor(() => expect(notifyError).toHaveBeenCalled());
  expect(store.state.model.defaultProviderId).toBe('codex');
  expect(store.state.backgroundAgentSettings).toBe(before);
  expect(update).not.toHaveBeenCalled();
  expect(notifySuccess).not.toHaveBeenCalled();
  const request = dispatch.mock.calls.find(
    ([action]) => action.type === 'providerSettings/setActiveProvider',
  )?.[0];
  expect(request).toBeDefined();
  const context = (request as { payload: [string, { id: string; sessionId: string }] }).payload[1];
  expect(selectProviderSettingsSessionRequests.select(store.state, context.sessionId)).toEqual([
    { ...context, resource: 'default', status: 'failure' },
  ]);
  expect(
    dispatch.mock.calls.some(([action]) => action.type === 'model/reloadModelsForProvider'),
  ).toBe(false);
  dispatch.mockRestore();
});
