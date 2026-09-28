import { appClient } from '$lib/client';
import { store as appStore } from '$store/renderer/store';
import {
  fastModeHydrationStarted,
  fastModeSupportReceived,
  hydrateProviderFastMode,
} from '$store/renderer/slices/provider-settings/provider-settings-slice';
import { selectProviderFastModeState } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import { providerFastModeSaga } from '$store/renderer/slices/provider-settings/sagas/provider-fast-mode-saga';

/** Exercise production persistence against an isolated, in-memory daemon seam. */
export function setupProviderFastModePreview(supported = true, rejectWrites = false) {
  const before = selectProviderFastModeState.select(appStore.state);
  const update = appClient.settings.updateSnapshot;
  let revision = 1;
  appClient.settings.updateSnapshot = async (changes) => {
    if (rejectWrites) throw new Error('Fixture daemon rejected Fast mode');
    return { applied: changes, revision: ++revision };
  };
  appStore.dispatch(fastModeHydrationStarted());
  appStore.dispatch(hydrateProviderFastMode({ codex: true, 'claude-code': false }, revision));
  appStore.dispatch(fastModeSupportReceived(supported));
  const stop = appStore.runSaga(providerFastModeSaga);
  return () => {
    stop();
    appClient.settings.updateSnapshot = update;
    appStore.dispatch(fastModeHydrationStarted());
    appStore.dispatch(hydrateProviderFastMode(before.confirmed, before.revision));
    appStore.dispatch(fastModeSupportReceived(before.supported));
  };
}
