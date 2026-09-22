<script lang="ts">
  import { store as appStore } from '$store/renderer/store';
  import {
    openPanel,
    setChiefCollapsed,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import SidebarPanel from '../SidebarPanel.svelte';

  let { height = 640 }: { height?: number } = $props();

  // The CT bundle initializes the store; open the combined Spaces + Chief
  // panel with the Chief expanded so the split list owns a live height.
  appStore.dispatch(setChiefCollapsed(false));
  appStore.dispatch(openPanel('chief'));
</script>

<div class="bg-sidebar text-sidebar-foreground" style:height="{height}px" style:width="320px">
  <SidebarPanel />
</div>
