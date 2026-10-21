import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { store } from '$store/renderer/store';
import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import { MOCK_PROVIDER_CATALOG } from '../../../../test/fixtures/provider-catalog.fixture';
import ProviderFailoverNotice from '../ProviderFailoverNotice.svelte';

const PROFILES = [
  {
    id: 'ppersonal',
    providerRef: 'claude-code@ppersonal',
    baseProviderId: 'claude-code',
    name: 'Personal',
  },
  { id: 'pwork', providerRef: 'claude-code@pwork', baseProviderId: 'claude-code', name: 'Work' },
];

const NOTICE = {
  fromProvider: 'claude-code@ppersonal',
  toProvider: 'claude-code@pwork',
  model: 'opus',
  reason: 'quota-exceeded',
};

let dispose: () => void;
beforeEach(() => {
  dispose = store.init();
});
afterEach(() => {
  cleanup();
  dispose();
});

describe('ProviderFailoverNotice', () => {
  it('renders one informational status divider with both profile names', () => {
    store.dispatch(
      providerCatalogLoaded({ providers: MOCK_PROVIDER_CATALOG.providers, profiles: PROFILES }),
    );
    render(ProviderFailoverNotice, { notice: NOTICE });
    const status = screen.getByRole('status');
    expect(status.textContent?.trim()).toBe(
      'Personal ran out of quota — continuing on Work (backup)',
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('relabels a mounted notice when the catalog loads, a profile is renamed or removed', async () => {
    render(ProviderFailoverNotice, { notice: NOTICE });
    const status = screen.getByRole('status');
    expect(status.textContent).not.toContain('Removed profile');

    store.dispatch(
      providerCatalogLoaded({ providers: MOCK_PROVIDER_CATALOG.providers, profiles: PROFILES }),
    );
    await waitFor(() =>
      expect(status.textContent).toContain('Personal ran out of quota — continuing on Work'),
    );

    store.dispatch(
      providerCatalogLoaded({
        providers: MOCK_PROVIDER_CATALOG.providers,
        profiles: [{ ...PROFILES[1], name: 'Job' }],
      }),
    );
    await waitFor(() =>
      expect(status.textContent).toContain('Removed profile ran out of quota — continuing on Job'),
    );
  });

  it('shows the fallback text when the metadata is incomplete', () => {
    render(ProviderFailoverNotice, {
      notice: { model: null },
      fallbackText: 'Saved daemon sentence',
    });
    expect(screen.getByRole('status').textContent).toContain('Saved daemon sentence');
  });

  it('defaults the fallback to a generic backup-switch label', () => {
    render(ProviderFailoverNotice, { notice: { model: null } });
    expect(screen.getByRole('status').textContent).toContain('Switched to a backup provider');
  });
});
