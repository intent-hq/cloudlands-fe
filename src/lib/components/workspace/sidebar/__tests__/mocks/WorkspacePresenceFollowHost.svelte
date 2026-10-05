<script lang="ts">
  import { onDestroy } from 'svelte';
  import WorkspaceProgressCard from '../../WorkspaceProgressCard.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { selectWorkspaceNavigationMainPanel } from '$store/renderer/slices/workspace-navigation/workspace-navigation-selectors';
  import type { HostRole } from '$shared/types/principal';
  import { initializePresenceFollowFixture } from './presence-follow-fixture';
  let { hidden = false, role = 'member' }: { hidden?: boolean; role?: HostRole } = $props();
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  /* eslint-disable intent/no-component-async-data-fetch -- Synchronous test bridge setup; the real saga owns all requests against this mock. */
  // svelte-ignore state_referenced_locally - the test scenario is fixed for each mount
  const disposeFixture = initializePresenceFollowFixture(hidden, role);
  /* eslint-enable intent/no-component-async-data-fetch */
  const destinationPanel = selectWorkspaceNavigationMainPanel('destination');
  onDestroy(() => {
    disposeFixture();
    disposeStore();
  });
</script>

<div
  class="flex min-h-80 flex-wrap bg-background text-foreground"
  data-testid="presence-follow-host"
>
  <aside class="w-72 shrink-0 bg-sidebar p-6">
    <WorkspaceProgressCard workspaceId="source" />
  </aside>
  <section class="min-w-48 flex-1 p-6" aria-label="Destination navigation state">
    {#if $destinationPanel.type === 'notes' && $destinationPanel.selectedNoteId === 'project-plan'}
      <p class="text-sm text-muted-foreground">Shared destination</p>
      <h2 class="mt-2 text-lg font-semibold">Project plan</h2>
      <p class="mt-4 text-sm">The selected note is open in this workspace’s navigation state.</p>
    {:else}
      <h2 class="text-lg font-semibold">Planning</h2>
      <p class="mt-4 text-sm text-muted-foreground">
        Follow Alex’s avatar to their reachable view.
      </p>
    {/if}
  </section>
</div>
