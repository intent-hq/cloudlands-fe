import { store as appStore } from '$store/renderer/store';
import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import { remoteMachinesLoaded } from '$features/remote-machines/remote-machines-slice';

/** Remote machines visible: Labs on and a backend that supports them. */
export function setupRemoteReadyPreview() {
  const before = appStore.state;
  const previousLabs = before.userPreferences?.labsRemoteAgentsEnabled === true;
  const previousRemote = before.remoteMachines;
  appStore.dispatch(setLabsRemoteAgentsEnabled(true));
  appStore.dispatch(
    remoteMachinesLoaded({
      supported: true,
      machines: [],
      localFingerprint: null,
      executorBackends: null,
    }),
  );
  return () => {
    appStore.dispatch(setLabsRemoteAgentsEnabled(previousLabs));
    appStore.dispatch(
      remoteMachinesLoaded({
        supported: previousRemote.supported,
        machines: Object.values(previousRemote.machines),
        localFingerprint: previousRemote.localFingerprint,
        executorBackends: previousRemote.executorBackends ?? null,
      }),
    );
  };
}
