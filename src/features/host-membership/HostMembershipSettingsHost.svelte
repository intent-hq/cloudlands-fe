<script lang="ts">
  import {
    selectPrincipalState,
    selectPrincipalConnectionContext,
  } from '$store/renderer/slices/principal/principal-selectors';
  import {
    selectHostMembershipContext,
    selectHostMembershipState,
  } from '$store/renderer/slices/host-membership/host-membership-selectors';
  import { selectLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import HostMembershipSettings from './HostMembershipSettings.svelte';

  const principal$ = selectPrincipalState();
  const connection$ = selectPrincipalConnectionContext();
  const context$ = selectHostMembershipContext();
  const membership$ = selectHostMembershipState();
  const multiplayer$ = selectLabsMultiplayerEnabled();
  const admitted = $derived(
    $context$ && $principal$.snapshot && $connection$
      ? {
          context: $context$,
          connection: $connection$,
          principalId: $principal$.snapshot.principal.id,
          revision: $principal$.snapshot.principal.hostMembershipRevision ?? 0,
          version: $principal$.presentationVersion,
          lifetime: JSON.stringify([
            $connection$,
            $principal$.snapshot.principal.id,
            $principal$.snapshot.principal.identity,
            $principal$.presentationVersion,
          ]),
        }
      : null,
  );
  let retained = $state<typeof admitted>(null);
  // Membership events briefly withhold authority while principal.me is re-read.
  // Retain presentation only; every action remains blocked by the live selector.
  const suspended = $derived(
    !admitted &&
      !!retained &&
      $multiplayer$ &&
      !$membership$.withheld &&
      $principal$.status === 'loading' &&
      $connection$ === retained.connection &&
      $principal$.context === retained.connection &&
      $principal$.boundPrincipalId === retained.principalId &&
      $principal$.presentationVersion === retained.version &&
      $principal$.minimumRevision > retained.revision,
  );
  const presentation = $derived(admitted ?? (suspended ? retained : null));
  $effect(() => {
    if (admitted) retained = admitted;
    else if (!suspended) retained = null;
  });
</script>

{#if presentation}
  {#key presentation.lifetime}
    <HostMembershipSettings context={presentation.context} {suspended} />
  {/key}
{/if}
