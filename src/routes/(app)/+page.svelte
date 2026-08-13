<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import { setShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { store as appStore } from '$store/renderer/store';
</script>

<svelte:head>
  <title>{m.home_page_title()}</title>
</svelte:head>

<div class="flex h-full flex-col items-center justify-center gap-1.5 text-center">
  <p class="text-lg font-medium text-foreground">{m.home_emptyState_noSpaceSelected_label()}</p>
  <p class="text-sm text-subtle">{m.home_emptyState_selectOrCreate_description()}</p>
  <button
    type="button"
    class="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
    onclick={() => appStore.dispatch(setShowCreateModal(true))}
  >
    {m.home_emptyState_newSpace_label()}
  </button>
</div>
