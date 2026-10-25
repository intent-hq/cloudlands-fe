<script lang="ts">
  import IntentMarkLoader from '../IntentMarkLoader.svelte';
  import type { IntentMarkVariant } from '../intent-mark-motion';

  let {
    variant = 'bloom',
    size = 128,
    playing = true,
    theme = 'light',
    zoom = 1,
  }: {
    variant?: IntentMarkVariant;
    size?: number;
    playing?: boolean;
    theme?: 'light' | 'dark';
    zoom?: number;
  } = $props();
</script>

<main class:dark={theme === 'dark'} class="mark-host" style={`zoom:${zoom}`} data-theme={theme}>
  <IntentMarkLoader {variant} {size} {playing} />
</main>

<style>
  .mark-host {
    --background: var(--theme-light-background);
    --foreground: var(--theme-light-foreground);
    display: grid;
    width: 22rem;
    height: 22rem;
    place-items: center;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
  }

  .mark-host.dark {
    --background: var(--theme-dark-background);
    --foreground: var(--theme-dark-foreground);
  }
</style>
