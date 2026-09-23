<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$store/renderer/store';
  import { setThemeName } from '$store/renderer/slices/theme/theme-slice';
  import ConnectionsSettings from './ConnectionsSettings.svelte';
  let { theme }: { theme: 'light' | 'dark' } = $props();
  onMount(() => {
    store.dispatch(setThemeName(theme));
  });
</script>

<ConnectionsSettings />
