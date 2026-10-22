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
  import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
  import PullRequestCreator from '$lib/components/workspace/PullRequestCreator.svelte';
  import { ConfirmHost } from '$lib/components/patterns/confirm';

  let { sidebar = false }: { sidebar?: boolean } = $props();
  const context = initAppStore(store);
  store.dispatch(setLabsMultiplayerEnabled(true));
  const workspaces = selectWorkspaceItems();
  const principal = selectPrincipalSnapshot();
  const role = selectHostRole();
  const admission = selectPrincipalActionContext();
  const workspaceAdmission = store.createSelector((state) => state.workspace.capabilityContext)();
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

  let sidebarInstance: SidebarChangesPanel | undefined;
  let dismissal: Promise<void> | null = null;
  let retirement: ReturnType<SidebarChangesPanel['observeNativeRetirement']> | null = null;
  async function dismissStandalone() {
    visible = false;
    await tick();
  }
  export function dismiss(): Promise<void> {
    if (!sidebar) return dismissStandalone();
    if (dismissal) return dismissal;
    const original = sidebarInstance;
    if (!original)
      return (dismissal = Promise.reject(new Error('Original sidebar instance missing')));
    try {
      retirement = original.observeNativeRetirement();
    } catch (error) {
      return (dismissal = Promise.reject(error));
    }
    const captured = retirement;
    visible = false;
    dismissal = Promise.all([tick(), captured.completion])
      .then(() => {})
      .finally(() => {
        captured.release();
        if (retirement === captured) retirement = null;
      });
    return dismissal;
  }
  onDestroy(() => {
    retirement?.cancel(new Error('Original fixture lifetime ended during dismissal'));
    retirement?.release();
    retirement = null;
    context.dispose();
  });
</script>

<div class="native-fixture" data-ui-role={$role ?? 'unavailable'}>
  {#if visible && $principal && $workspaces.length === 1}
    {#if sidebar}
      <SidebarChangesPanel workspaceId={String($workspaces[0].id)} bind:this={sidebarInstance} />
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
