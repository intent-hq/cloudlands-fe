<script lang="ts">
  import FaWrapper from '$lib/components/shared/icons/FaWrapper.svelte';
  import { faPlus } from '$lib/icons/phosphor-icons';
  import { Button } from '$lib/components/ui/button';
  import { setShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  function openNewWorkspace() {
    appStore.dispatch(setShowCreateModal(true));
  }
</script>

<div
  class="app-no-drag shrink-0"
  data-workspace-repo-launcher
  style:translate="var(--workspace-tab-launcher-offset, 0px) 0"
>
  <Button
    variant="ghost"
    size="icon"
    iconOnly
    class="size-8 shrink-0 border-transparent text-foreground hover:border-transparent hover:bg-transparent hover:text-foreground active:bg-muted focus-visible:border-foreground focus-visible:bg-muted focus-visible:outline-0 focus-visible:outline-offset-0 focus-visible:ring-0 [&_svg]:size-4!"
    onclick={openNewWorkspace}
    aria-label={m.menu_new_workspace()}
    tooltip={m.menu_new_workspace()}
    tooltipSide="bottom"
  >
    <FaWrapper icon={faPlus} size={16} class="pointer-events-none size-4!" />
  </Button>
</div>

<style>
  :global([data-workspace-repo-launcher] button:focus-visible) {
    outline-width: 0;
    outline-offset: 0;
  }

  @media (forced-colors: active) {
    :global([data-workspace-repo-launcher] button:focus-visible) {
      border-color: ButtonText;
    }
  }
</style>
