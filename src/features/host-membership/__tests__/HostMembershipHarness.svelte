<script lang="ts">
  import { onDestroy } from 'svelte';
  import { hostMembershipChanged } from '$store/renderer/slices/principal/principal-slice';
  import { hostMembershipListsChanged } from '$store/renderer/slices/host-membership/host-membership-slice';
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
  import { invitationAccountSearchSaga } from '$store/renderer/slices/invitation-account-search/sagas/invitation-account-search-saga';
  import { hostUserPresenceSaga } from '$store/renderer/slices/host-membership/sagas/host-user-presence-saga';
  import { hostMembershipSaga } from '$store/renderer/slices/host-membership/sagas/host-membership-saga';
  import HostMembershipSettingsHost from '../HostMembershipSettingsHost.svelte';

  const {
    confirmationRevalidation = false,
    autocomplete = false,
  }: { confirmationRevalidation?: boolean; autocomplete?: boolean } = $props();
  const previous = store.state.principal;
  const previousMultiplayer = store.state.userPreferences.labsMultiplayerEnabled;
  const previousGitLab = store.state.userPreferences.labsGitLabEnabled;
  store.dispatch(setLabsMultiplayerEnabled(true));
  store.dispatch(setLabsGitLabEnabled(true));
  admitLegacyPrincipal();
  function admit(role: 'owner' | 'member') {
    const { principal } = withHostPrincipal(store.state, role);
    principal.snapshot!.capabilities.invitationAccountSearch = autocomplete;
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
  const admitted = store.state.principal.snapshot!;
  function suspendAuthority() {
    store.dispatch(
      hostMembershipChanged({
        revision: 2,
        principalId: 'other-member',
        hostRole: 'member',
        action: 'added',
      }),
    );
    store.dispatch(hostMembershipListsChanged());
  }

  function restoreAuthority() {
    store.dispatch(
      principalReceived(
        {
          context: store.state.principal.context!,
          invalidation: store.state.principal.invalidation,
          presentationVersion: store.state.principal.presentationVersion,
        },
        { ...admitted, principal: { ...admitted.principal, hostMembershipRevision: 2 } },
      ),
    );
  }
  const stop = store.runSaga(hostMembershipSaga);
  const stopSearch = store.runSaga(invitationAccountSearchSaga);
  const stopPresence = store.runSaga(hostUserPresenceSaga);
  onDestroy(() => {
    stop();
    stopSearch();
    stopPresence();
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
  {#if confirmationRevalidation}
    <button data-testid="suspend-authority" onclick={suspendAuthority}>Suspend authority</button>
    <button data-testid="restore-authority" onclick={restoreAuthority}>Restore authority</button>
  {/if}
  <HostMembershipSettingsHost />
</section>
