import { store as appStore } from '$store/renderer/store';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { remoteMachinesLoaded } from '$features/remote-machines/remote-machines-slice';
import {
  hydrateRemoteMachineSignIn,
  remoteMachineSignInSupportReceived,
} from '$store/renderer/slices/provider-settings/provider-settings-slice';
import { selectRemoteMachineSignInState } from '$store/renderer/slices/provider-settings/provider-settings-selectors';
import { appClient } from '$lib/client';
import { providerRemoteMachineSignInSaga } from '$store/renderer/slices/provider-settings/sagas/provider-remote-machine-sign-in-saga';

/**
 * Remote machines visible (Labs on, a backend that supports them) and
 * `providers.remoteMachineSignIn` stored by an in-memory settings seam.
 */
export function setupRemoteReadyPreview(machineSignIn: Record<string, boolean> = {}) {
  const before = appStore.state;
  const previousLabs = before.userPreferences?.labsRemoteAgentsEnabled === true;
  const previousRemote = before.remoteMachines;
  const previousSignIn = selectRemoteMachineSignInState.select(before);
  const update = appClient.settings.updateSnapshot;
  let revision = previousSignIn.revision + 1;
  appClient.settings.updateSnapshot = async (changes) => ({
    applied: changes,
    revision: ++revision,
  });
  appStore.dispatch(setLabsRemoteAgentsEnabled(true));
  appStore.dispatch(
    remoteMachinesLoaded({
      supported: true,
      machines: [],
      localFingerprint: null,
      executorBackends: null,
    }),
  );
  appStore.dispatch(remoteMachineSignInSupportReceived(true));
  appStore.dispatch(hydrateRemoteMachineSignIn(machineSignIn, revision));
  const stop = appStore.runSaga(providerRemoteMachineSignInSaga);
  return () => {
    stop();
    appClient.settings.updateSnapshot = update;
    appStore.dispatch(setLabsRemoteAgentsEnabled(previousLabs));
    appStore.dispatch(
      remoteMachinesLoaded({
        supported: previousRemote.supported,
        machines: Object.values(previousRemote.machines),
        localFingerprint: previousRemote.localFingerprint,
        executorBackends: previousRemote.executorBackends ?? null,
      }),
    );
    appStore.dispatch(remoteMachineSignInSupportReceived(previousSignIn.supported));
    appStore.dispatch(
      hydrateRemoteMachineSignIn(previousSignIn.confirmed, previousSignIn.revision),
    );
  };
}
