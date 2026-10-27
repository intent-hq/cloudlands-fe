import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store } from '$store/renderer/store';
import { selectAllProviderWarnings } from '$store/renderer/slices/model/model-selectors';
import { selectResolvedProviderCatalogEntry } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { selectProviderModelsCacheMap } from '$store/renderer/slices/provider-models/provider-models-selectors';
import { getModelsForProviderForLoadingState } from '$store/renderer/slices/model/model-utils';
import { preview } from './model-picker.preview';

vi.mock('./ModelPickerPreview.svelte', () => ({ default: vi.fn() }));

let storeContext: ReduxStoreContext | undefined;

beforeEach(() => {
  storeContext = initAppStore(store);
});

afterEach(() => {
  storeContext?.dispose();
  storeContext = undefined;
});

describe('model picker codex-fallback preview state', () => {
  it('serves the built-in Codex list with a fallback warning, then tears it down', async () => {
    const state = preview.states['codex-fallback'];
    expect(state.props).toMatchObject({ initialOpen: true, captureMenu: true, portal: false });

    const cleanup = state.setup?.() || undefined;

    // The open picker's install notice needs the warning, the usable models
    // and the Codex docs link together (not the blocking "Failed to load" path).
    const warning = selectAllProviderWarnings.select(store.state).codex;
    expect(warning).toBeTruthy();
    expect(selectProviderModelsCacheMap.select(store.state).codex?.models.length).toBeGreaterThan(
      0,
    );
    expect(selectResolvedProviderCatalogEntry.select(store.state, 'codex')?.loginDocsUrl).toMatch(
      /^https:\/\//,
    );
    // Retry refetches through the preview's IPC handler; the warning survives it.
    const refetched = await getModelsForProviderForLoadingState('codex', { forceRefresh: true });
    expect(refetched.warning).toBe(warning);
    expect(refetched.models.length).toBeGreaterThan(0);

    cleanup?.();
    expect(selectAllProviderWarnings.select(store.state).codex).toBeUndefined();
    expect(
      selectResolvedProviderCatalogEntry.select(store.state, 'codex')?.loginDocsUrl,
    ).toBeUndefined();
  });

  it('leaves the other open-menu states without the fallback warning', () => {
    for (const name of ['open', 'adapter-error'] as const) {
      const cleanup = preview.states[name].setup?.() || undefined;
      expect(selectAllProviderWarnings.select(store.state).codex, name).toBeUndefined();
      cleanup?.();
    }
  });
});
