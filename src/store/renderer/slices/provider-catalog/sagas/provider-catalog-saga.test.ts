import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
}));

vi.mock('$lib/client', () => ({ appClient: { providers: { catalog: mocks.catalog } } }));

import type { ProviderCatalogResult } from '$shared/provider-catalog';
import { providerCatalogLoaded } from '../provider-catalog-slice';
import { hydrateProviderCatalog } from './provider-catalog-saga';

const CATALOG: ProviderCatalogResult = {
  providers: [],
  defaultProviderId: 'auggie',
};

describe('hydrateProviderCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.catalog.mockResolvedValue(CATALOG);
  });

  it('requests providers.catalog with no parameters and dispatches the wire response verbatim', async () => {
    const dispatch = vi.fn();
    await runSaga({ dispatch }, hydrateProviderCatalog).toPromise();

    expect(mocks.catalog).toHaveBeenCalledTimes(1);
    expect(mocks.catalog).toHaveBeenCalledWith();
    expect(dispatch).toHaveBeenCalledWith(providerCatalogLoaded(CATALOG));
  });

  it('keeps the previous catalog when hydration fails', async () => {
    mocks.catalog.mockRejectedValue(new Error('uds boom'));
    const dispatch = vi.fn();
    await runSaga({ dispatch }, hydrateProviderCatalog).toPromise();

    expect(dispatch).not.toHaveBeenCalled();
  });
});
