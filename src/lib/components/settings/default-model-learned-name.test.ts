import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { store } from '$store/renderer/store';
import {
  providerModelsCacheCleared,
  providerModelsLoaded,
} from '$store/renderer/slices/provider-models/provider-models-slice';
import {
  hydrateDefaultProvider,
  loadDefaultReasoningEffortFromStorage,
  setAvailableModels,
  setDefaultReasoningEffort,
} from '$store/renderer/slices/model/model-slice';
import DefaultAgentModelSettings from './DefaultAgentModelSettings.svelte';

vi.mock('$lib/components/chat/input/ModelPicker.svelte', async () => ({
  default: (await import('../chat/__tests__/mocks/ModelPicker.svelte')).default,
}));
let dispose: () => void;
beforeEach(() => {
  dispose = store.init();
  store.dispatch(hydrateDefaultProvider('codex'));
  store.dispatch(loadDefaultReasoningEffortFromStorage('high'));
  store.dispatch(
    providerModelsLoaded(
      'codex',
      { models: [{ value: 'remembered', label: 'Remembered model' }] },
      0,
    ),
  );
  store.dispatch(providerModelsCacheCleared());
});
afterEach(() => {
  cleanup();
  dispose();
  vi.restoreAllMocks();
});

async function pick(model: string) {
  const dispatch = vi.spyOn(store, 'dispatch');
  render(DefaultAgentModelSettings, { workspaceId: null });
  const input = screen.getByTestId('model-picker-trigger-input') as HTMLInputElement;
  input.value = model;
  await fireEvent.click(screen.getByTestId('model-picker-trigger'));
  return dispatch;
}

it('does not clear effort when only a learned display name exists', async () => {
  const dispatch = await pick('remembered');
  expect(dispatch).not.toHaveBeenCalledWith(setDefaultReasoningEffort(''));
  expect(store.state.model.defaultReasoningEffort).toBe('high');
});

it.each([
  { effortLevels: undefined, clears: true },
  { effortLevels: ['low'], clears: true },
  { effortLevels: ['low', 'high'], clears: false },
])('uses actual provider metadata to reconcile effort (%j)', async ({ effortLevels, clears }) => {
  store.dispatch(
    setAvailableModels(
      [{ value: 'remembered', label: 'Other provider', effortLevels: ['low'] }],
      'auggie',
    ),
  );
  store.dispatch(
    providerModelsLoaded(
      'codex',
      { models: [{ value: 'remembered', label: 'Live model', effortLevels }] },
      store.state.providerModels.clearEpoch,
    ),
  );
  const dispatch = await pick('codex:remembered');
  if (clears) expect(dispatch).toHaveBeenCalledWith(setDefaultReasoningEffort(''));
  else expect(dispatch).not.toHaveBeenCalledWith(setDefaultReasoningEffort(''));
});
