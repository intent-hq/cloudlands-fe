<script lang="ts">
  import { tick, onDestroy } from 'svelte';
  import { store, initAppStore } from '$store/renderer/store';
  import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import {
    selectPrincipalSnapshot,
    selectHostRole,
  } from '$store/renderer/slices/principal/principal-selectors';
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import PullRequestCreator from '$lib/components/workspace/PullRequestCreator.svelte';
  import { ConfirmHost } from '$lib/components/patterns/confirm';

  const context = initAppStore(store);
  store.dispatch(setLabsMultiplayerEnabled(true));
  const workspaces = selectWorkspaceItems();
  const principal = selectPrincipalSnapshot();
  const role = selectHostRole();
  let visible = $state(true);
  export async function dismiss() {
    visible = false;
    await tick();
  }
  onDestroy(context.dispose);
</script>

<div class="native-fixture" data-ui-role={$role ?? 'unavailable'}>
  {#if visible && $principal && $workspaces.length === 1}
    <PullRequestCreator
      workspaceId={WorkspaceId($workspaces[0].id)}
      onClose={() => (visible = false)}
    />
  {:else if visible}
    <p role="status">Waiting for the original host and workspace</p>
  {/if}
  <ConfirmHost />
</div>

<style>
  .native-fixture {
    max-width: 760px;
    margin: 16px auto;
  }
</style>
