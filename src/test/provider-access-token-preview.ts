import { appClient } from '$lib/client';
import { store } from '$store/renderer/store';
import { providerAccessTokenSaga } from '$store/renderer/slices/provider-settings/sagas/provider-access-token-saga';
import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
import { selectProviderCatalogEntries } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';

/** In-memory daemon fixture: retain only booleans, never submitted draft strings. */
export function setupProviderAccessTokenPreview(rejectWrites = false) {
  const catalog = selectProviderCatalogEntries.select(store.state);
  const get = appClient.settings.get;
  const update = appClient.settings.update;
  const reset = appClient.settings.reset;
  const configured: Record<string, boolean> = {
    'providers.claude-code.accessToken': false,
    'providers.codex.accessToken': true,
  };
  appClient.settings.get = async (path) =>
    path in configured
      ? {
          path,
          label: 'Access token',
          description: '',
          category: 'providers',
          type: 'string',
          sensitive: true,
          value: configured[path] ? '********' : null,
        }
      : get.call(appClient.settings, path);
  appClient.settings.update = async (changes) => {
    if (rejectWrites) throw new Error('Fixture save failure');
    return changes.map(({ path }) => {
      configured[path] = true;
      return { path, value: '********' };
    });
  };
  appClient.settings.reset = async (path) => {
    if (rejectWrites) throw new Error('Fixture remove failure');
    configured[path] = false;
    return { path, value: null };
  };
  const stop = store.runSaga(providerAccessTokenSaga);
  store.dispatch(
    providerCatalogLoaded({
      providers: catalog.map((provider) => ({
        ...provider,
        ...(provider.id === 'claude-code' || provider.id === 'codex'
          ? {
              accessToken: {
                kind:
                  provider.id === 'claude-code'
                    ? ('claudeSetupToken' as const)
                    : ('codexAccessToken' as const),
                settingPath: `providers.${provider.id}.accessToken`,
                label: 'Access token',
                guidance: 'Fixture provider guidance',
              },
            }
          : {}),
      })),
    }),
  );
  return () => {
    stop();
    appClient.settings.get = get;
    appClient.settings.update = update;
    appClient.settings.reset = reset;
    store.dispatch(providerCatalogLoaded({ providers: catalog }));
  };
}
