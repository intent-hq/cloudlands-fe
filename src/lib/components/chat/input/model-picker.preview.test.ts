import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store } from '$store/renderer/store';
import {
  selectAllProviderWarningKinds,
  selectAllProviderWarnings,
} from '$store/renderer/slices/model/model-selectors';
import { selectResolvedProviderCatalogEntry } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import {
  selectProviderModelsCacheMap,
  selectProviderModelsRequests,
} from '$store/renderer/slices/provider-models/provider-models-selectors';
import { providerModelsRequested } from '$store/renderer/slices/provider-models/provider-models-slice';
import { setLoadingStateForProvider } from '$store/renderer/slices/model/model-slice';
import { preview } from './model-picker.preview';

vi.mock('./ModelPickerPreview.svelte', () => ({ default: vi.fn() }));

let storeContext: ReduxStoreContext | undefined;
let activeCleanup: (() => void) | undefined;

beforeEach(() => {
  storeContext = initAppStore(store);
});

afterEach(() => {
  // Tear down even when an assertion failed, so mock IPC overrides never leak.
  activeCleanup?.();
  activeCleanup = undefined;
  storeContext?.dispose();
  storeContext = undefined;
});

type StateName = keyof typeof preview.states;

function setup(name: StateName) {
  const cleanup = preview.states[name].setup?.() || undefined;
  activeCleanup = cleanup;
  return cleanup;
}

// Only the provider-models saga records request status, so a settled request
// proves the catalog came through the app's loading code, not a direct write.
async function settled(...providerIds: string[]) {
  await vi.waitFor(() => {
    const requests = selectProviderModelsRequests.select(store.state);
    for (const providerId of providerIds) expect(requests[providerId]?.status).toBe('success');
  });
}

describe('model picker codex-fallback preview state', () => {
  it('serves the daemon missing-CLI answer that Retry recovers, then tears it down', async () => {
    const cleanup = setup('codex-fallback');
    await settled('codex', 'claude-code');

    // The daemon's missing-CLI answer: an empty catalog, the real warning and
    // `warningKind: "cli-missing"`, which the open picker's install notice
    // keys on, plus the Codex docs link the notice shows.
    const warning = selectAllProviderWarnings.select(store.state).codex;
    expect(warning).toMatch(/make it available on PATH/);
    expect(selectAllProviderWarningKinds.select(store.state).codex).toBe('cli-missing');
    const cache = selectProviderModelsCacheMap.select(store.state);
    expect(cache.codex?.warning).toBe(warning);
    expect(cache.codex?.warningKind).toBe('cli-missing');
    expect(cache.codex?.models).toEqual([]);
    expect(selectResolvedProviderCatalogEntry.select(store.state, 'codex')?.loginDocsUrl).toMatch(
      /^https:\/\//,
    );
    // Retry after installing the CLI loads the real rows and clears both.
    store.dispatch(providerModelsRequested('codex', 'retry'));
    await vi.waitFor(() => {
      expect(selectProviderModelsCacheMap.select(store.state).codex?.models.length).toBe(3);
    });
    expect(selectAllProviderWarnings.select(store.state).codex).toBeUndefined();
    expect(selectAllProviderWarningKinds.select(store.state).codex).toBeUndefined();

    cleanup?.();
    expect(selectAllProviderWarnings.select(store.state).codex).toBeUndefined();
    expect(selectProviderModelsCacheMap.select(store.state).codex).toBeUndefined();
    expect(
      selectResolvedProviderCatalogEntry.select(store.state, 'codex')?.loginDocsUrl,
    ).toBeUndefined();
  });

  it('leaves the populated open menu without a warning', async () => {
    const cleanup = setup('open');
    await settled('codex', 'claude-code');
    expect(selectAllProviderWarnings.select(store.state)).toEqual({});
    expect(selectProviderModelsCacheMap.select(store.state).codex?.models.length).toBe(3);
    cleanup?.();
  });
});

describe('model picker degraded preview states', () => {
  it.each([
    ['adapter-error', ['codex']],
    ['recovery', ['codex', 'claude-code']],
  ] as const)('%s loads a degraded catalog that Retry recovers', async (name, degraded) => {
    const cleanup = setup(name);
    await settled('codex', 'claude-code');
    const cache = selectProviderModelsCacheMap.select(store.state);
    for (const providerId of degraded) {
      expect(cache[providerId]?.models, providerId).toEqual([]);
      expect(cache[providerId]?.warning, providerId).toBeTruthy();
      // The saga stores the degraded warning on the loading state too.
      expect(selectAllProviderWarnings.select(store.state)[providerId]).toBe(
        cache[providerId]?.warning,
      );
      // A probe failure (adapter crash, timeout) is not a missing CLI.
      expect(selectAllProviderWarningKinds.select(store.state)[providerId]).toBeUndefined();
    }

    store.dispatch(providerModelsRequested('codex', 'retry'));
    await vi.waitFor(() => {
      expect(selectProviderModelsCacheMap.select(store.state).codex?.models.length).toBe(3);
    });
    expect(selectAllProviderWarnings.select(store.state).codex).toBeUndefined();

    cleanup?.();
    expect(selectAllProviderWarnings.select(store.state)).toEqual({});
  });
});

describe('model picker profile preview states', () => {
  it('loads each profile catalog under its provider reference', async () => {
    const cleanup = setup('profiles-open');
    const refs = ['codex@pwork00000001', 'codex@ppers00000001', 'claude-code@pclwk0000001'];
    await settled('codex', 'claude-code', ...refs);
    const cache = selectProviderModelsCacheMap.select(store.state);
    for (const ref of refs) {
      const prefix = ref.split('@')[1];
      expect(cache[ref]?.models.map((model) => model.value)).toEqual([
        `${prefix}-preview-balanced`,
        `${prefix}-preview-fast`,
        `${prefix}-preview-deep`,
      ]);
    }
    cleanup?.();
    for (const ref of refs)
      expect(selectProviderModelsCacheMap.select(store.state)[ref]).toBeUndefined();
  });

  it('resets loading states the saga recorded for profiles on teardown', async () => {
    const ref = 'codex@pwork00000001';
    const cleanup = setup('profiles-open');
    await settled('codex', 'claude-code', ref);
    store.dispatch(
      setLoadingStateForProvider({ providerId: ref, status: 'success', warning: 'leftover' }),
    );
    cleanup?.();
    expect(selectAllProviderWarnings.select(store.state)[ref]).toBeUndefined();
    expect(Object.keys(selectProviderModelsRequests.select(store.state))).toEqual([]);
  });
});
