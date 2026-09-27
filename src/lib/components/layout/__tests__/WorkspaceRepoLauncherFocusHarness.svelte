<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { store } from '$store/renderer/store';
  import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
  import {
    principalContextChanged,
    principalReceived,
  } from '$store/renderer/slices/principal/principal-slice';
  import WorkspaceRepoLauncher from '../WorkspaceRepoLauncher.svelte';
  import {
    admitHostExecutionFixture,
    HOST_EXECUTION_FIXTURE,
  } from '../../../../test/fixtures/host-execution-state';
  import type { HostRole } from '$shared/types/principal';
  import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';

  let {
    admittedOwner = true,
    role,
    multiplayer = false,
  }: { admittedOwner?: boolean; role?: HostRole; multiplayer?: boolean } = $props();
  const dispose = store.init();
  const previousPrincipal = untrack(() => {
    const previous = store.state.principal;
    store.dispatch(setLabsMultiplayerEnabled(multiplayer));
    if (role) admitHostExecutionFixture(role, HOST_EXECUTION_FIXTURE);
    else if (admittedOwner) admitLegacyPrincipal();
    else store.dispatch(principalContextChanged(null));
    return previous;
  });

  onDestroy(() => {
    store.dispatch(principalContextChanged(previousPrincipal.context));
    if (previousPrincipal.context && previousPrincipal.snapshot)
      store.dispatch(
        principalReceived(
          { context: previousPrincipal.context, invalidation: 0, presentationVersion: 0 },
          previousPrincipal.snapshot,
        ),
      );
    dispose();
  });
</script>

<div>
  <WorkspaceRepoLauncher />
</div>
