<script lang="ts">
  import { store as appStore } from '$store/renderer/store';
  import SidebarPanel from '../../SidebarPanel.svelte';

  interface Props {
    setup?: () => void;
  }

  let { setup }: Props = $props();

  appStore.init();
  $effect.pre(() => setup?.());
</script>

<SidebarPanel />
