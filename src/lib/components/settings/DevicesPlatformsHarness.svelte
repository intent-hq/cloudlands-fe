<script lang="ts">
  import { onDestroy } from 'svelte';
  import { store } from '$store/renderer/store';
  import { setThemeName } from '$store/renderer/slices/theme/theme-slice';
  import Preview, { preview } from './devices-settings.preview.svelte';

  let { theme }: { theme: 'light' | 'dark' } = $props();
  // Seed the store with the preview's "platforms" machines (every platform
  // icon, versions, provider icons and an "Available to …" badge) before the
  // Machines list first renders.
  // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous preview fixture seeding via store.dispatch, not a data fetch
  const cleanup = preview.states.platforms.setup?.();
  store.dispatch(setThemeName(theme));
  onDestroy(() => cleanup?.());
</script>

<Preview />
