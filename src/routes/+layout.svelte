<script lang="ts">
  import '../app.css';
  import '@fontsource/ia-writer-mono/400.css';
  import '@fontsource/ia-writer-mono/400-italic.css';
  import '@fontsource/ia-writer-mono/700.css';
  import '@fontsource/ia-writer-mono/700-italic.css';
  import '@fontsource/jetbrains-mono/400.css';
  import '@fontsource/jetbrains-mono/400-italic.css';
  import '@fontsource/jetbrains-mono/500.css';
  import '@fontsource/jetbrains-mono/500-italic.css';
  import '@fontsource/jetbrains-mono/700.css';
  import '@fontsource/jetbrains-mono/700-italic.css';
  import '@fontsource/doto/700.css';
  import type { Snippet } from 'svelte';
  import RootAppProviders from './RootAppProviders.svelte';
  import { isDevConsoleRoute } from '$shared/dev-console-route';
  import { isDesktopOverlayRoute } from '$shared/desktop-overlay';
  let { children }: { children?: Snippet } = $props();
  const diagnostic =
    typeof window !== 'undefined' &&
    (isDevConsoleRoute(window.location.pathname) ||
      isDesktopOverlayRoute(window.location.pathname));
</script>

{#if diagnostic}
  {@render children?.()}
{:else}
  <RootAppProviders {children} />
{/if}
