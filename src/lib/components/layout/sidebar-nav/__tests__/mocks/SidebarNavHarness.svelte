<script lang="ts">
  import { store as appStore } from '$store/renderer/store';
  import SidebarNav from '../../SidebarNav.svelte';

  appStore.init();
</script>

<SidebarNav />
