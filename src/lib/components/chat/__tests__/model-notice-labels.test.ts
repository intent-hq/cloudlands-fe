import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { store } from '$store/renderer/store';
import {
  learnedModelNamesHydrated,
  providerModelsLoaded,
} from '$store/renderer/slices/provider-models/provider-models-slice';
import ModelChangeNotice from '../ModelChangeNotice.svelte';
import ProviderRehomedNotice from '../ProviderRehomedNotice.svelte';

let dispose: () => void;
beforeEach(() => {
  dispose = store.init();
});
afterEach(() => {
  cleanup();
  dispose();
});

for (const Component of [ModelChangeNotice, ProviderRehomedNotice]) {
  describe(Component.name, () => {
    it.each([false, true])(
      'refreshes a mounted notice as names and workspace catalogs arrive (hydrated %s)',
      async (hydrated) => {
        if (hydrated)
          store.dispatch(
            learnedModelNamesHydrated({ codex: { 'org/model:v2': 'Hydrated model' } }),
          );
        const { rerender } = render(Component, {
          workspaceId: 'visible-workspace',
          notice: {
            reason: 'provider_disabled',
            from: 'org/model:v2',
            to: 'unknown',
            fromProvider: 'codex',
            toProvider: 'auggie',
          },
        });
        const status = screen.getByRole('status');
        expect(status.textContent).toContain(hydrated ? 'Hydrated model' : 'org/model:v2');
        const discover = (workspaceId: string, label: string) =>
          store.dispatch(
            providerModelsLoaded(
              'codex',
              { models: [{ value: 'org/model:v2', label }] },
              0,
              workspaceId,
            ),
          );
        discover('other-workspace', 'Learned elsewhere');
        await tick();
        await waitFor(() => expect(status.textContent).toContain('Learned elsewhere'));
        discover('visible-workspace', 'Visible workspace name');
        await tick();
        await waitFor(() => expect(status.textContent).toContain('Visible workspace name'));
        discover('other-workspace', 'New name elsewhere');
        await tick();
        await waitFor(() => expect(status.textContent).toContain('Visible workspace name'));
        await rerender({ workspaceId: 'other-workspace' });
        await waitFor(() => expect(status.textContent).toContain('New name elsewhere'));
      },
    );
  });
}
