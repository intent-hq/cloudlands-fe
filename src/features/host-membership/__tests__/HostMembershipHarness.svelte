<script lang="ts">
  import { onDestroy } from 'svelte';
  import { store } from '$store/renderer/store';
  import { admitLegacyPrincipal, withHostPrincipal } from '../../../test/fixtures/principal-state';
  import {
    principalContextChanged,
    principalReceived,
  } from '$store/renderer/slices/principal/principal-slice';
  import {
    setLabsMultiplayerEnabled,
    setLabsGitLabEnabled,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { hostMembershipSaga } from '$store/renderer/slices/host-membership/sagas/host-membership-saga';
  import HostMembershipSettingsHost from '../HostMembershipSettingsHost.svelte';

  const previous = store.state.principal;
  const previousMultiplayer = store.state.userPreferences.labsMultiplayerEnabled;
  const previousGitLab = store.state.userPreferences.labsGitLabEnabled;
  store.dispatch(setLabsMultiplayerEnabled(true));
  store.dispatch(setLabsGitLabEnabled(true));
  admitLegacyPrincipal();
  function admit(role: 'owner' | 'member') {
    const { principal } = withHostPrincipal(store.state, role);
    store.dispatch(principalContextChanged(principal.context));
    store.dispatch(
      principalReceived(
        {
          context: principal.context!,
          invalidation: store.state.principal.invalidation,
          presentationVersion: store.state.principal.presentationVersion,
        },
        principal.snapshot!,
      ),
    );
  }
  admit('owner');
  const stop = store.runSaga(hostMembershipSaga);
  onDestroy(() => {
    stop();
    store.dispatch(setLabsMultiplayerEnabled(previousMultiplayer));
    store.dispatch(setLabsGitLabEnabled(previousGitLab));
    store.dispatch(principalContextChanged(previous.context));
    if (previous.context && previous.snapshot)
      store.dispatch(
        principalReceived(
          {
            context: previous.context,
            invalidation: store.state.principal.invalidation,
            presentationVersion: store.state.principal.presentationVersion,
          },
          previous.snapshot,
        ),
      );
  });
</script>

<section
  class="min-h-screen bg-background p-4 text-foreground"
  data-testid="collaboration-host-harness"
>
  <button onclick={() => admit('member')}>Simulate member</button>
  <button onclick={() => store.dispatch(setLabsMultiplayerEnabled(false))}
    >Disable Multiplayer</button
  >
  <HostMembershipSettingsHost />
</section>
