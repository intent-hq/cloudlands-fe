<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { store } from '$store/renderer/store';
  import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
  import {
    principalContextChanged,
    principalReceived,
  } from '$store/renderer/slices/principal/principal-slice';
  import WorkspaceRepoLauncher from '../WorkspaceRepoLauncher.svelte';

  let { admittedOwner = true }: { admittedOwner?: boolean } = $props();
  const dispose = store.init();
  const previousPrincipal = untrack(() => {
    const previous = store.state.principal;
    if (admittedOwner) admitLegacyPrincipal();
    else store.dispatch(principalContextChanged(null));
    return previous;
  });

  onDestroy(() => {
    dispose();
    store.dispatch(principalContextChanged(previousPrincipal.context));
    if (previousPrincipal.context && previousPrincipal.snapshot)
      store.dispatch(
        principalReceived(
          { context: previousPrincipal.context, invalidation: 0, presentationVersion: 0 },
          previousPrincipal.snapshot,
        ),
      );
  });
</script>

<div>
  <WorkspaceRepoLauncher />
</div>
