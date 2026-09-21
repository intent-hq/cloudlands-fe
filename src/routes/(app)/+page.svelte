<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { EmptyState } from '$lib/components/patterns/screen';
  import { m } from '$shared/paraglide/messages.js';
  import { setShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { store as appStore } from '$store/renderer/store';
</script>

<svelte:head>
  <title>{m.home_page_title()}</title>
</svelte:head>

<EmptyState class="h-full overflow-y-auto" emphasis="prominent">
  {#snippet title()}<h1>{m.home_emptyState_noSpaceSelected_label()}</h1>{/snippet}
  {#snippet description()}<p>{m.home_emptyState_selectOrCreate_description()}</p>{/snippet}
  {#snippet actions()}
    <Button variant="primary" onclick={() => appStore.dispatch(setShowCreateModal(true))}>
      {m.home_emptyState_newSpace_label()}
    </Button>
  {/snippet}
</EmptyState>
