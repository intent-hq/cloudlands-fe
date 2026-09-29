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
  import SidebarChangesPanel from '$lib/components/workspace/sidebar/SidebarChangesPanel.svelte';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { loadGitStatus } from '$store/renderer/slices/git/git-slice';
  import { refreshRequested } from '$store/renderer/slices/changes/changes-slice';
  import { selectPrincipalAdmissionContext } from '$store/renderer/slices/principal/principal-selectors';
  import PullRequestCreator from '$lib/components/workspace/PullRequestCreator.svelte';
  import { ConfirmHost } from '$lib/components/patterns/confirm';

  let { sidebar = false }: { sidebar?: boolean } = $props();
  const context = initAppStore(store);
  store.dispatch(setLabsMultiplayerEnabled(true));
  const workspaces = selectWorkspaceItems();
  const principal = selectPrincipalSnapshot();
  const role = selectHostRole();
  const admission = selectPrincipalAdmissionContext();
  const workspaceAdmission = store.createSelector(
    (state) => state.workspace.loadedPrincipalContext,
  )();
  let visible = $state(true);
  let hydrated: string | null = null;
  $effect(() => {
    if (
      !sidebar ||
      !visible ||
      !$principal ||
      !$admission ||
      $workspaceAdmission !== $admission ||
      $workspaces.length !== 1
    )
      return;
    const id = String($workspaces[0].id);
    const original = JSON.stringify([id, $admission]);
    if (hydrated === original) return;
    hydrated = original;
    store.dispatch(openWorkspaceTab(id));
    store.dispatch(loadGitStatus(id, true));
    store.dispatch(refreshRequested(id, true));
  });
  export async function dismiss() {
    visible = false;
    await tick();
  }
  onDestroy(context.dispose);
</script>

<div class="native-fixture" data-ui-role={$role ?? 'unavailable'}>
  {#if visible && $principal && $workspaces.length === 1}
    {#if sidebar}
      <SidebarChangesPanel workspaceId={String($workspaces[0].id)} />
    {:else}
      <PullRequestCreator
        workspaceId={WorkspaceId($workspaces[0].id)}
        onClose={() => (visible = false)}
      />
    {/if}
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
