<script lang="ts">
  import '@fontsource-variable/inter';
  import { onDestroy, onMount, type Snippet } from 'svelte';
  import { page } from '$app/state';
  import CatalogShell from '$lib/component-catalog/CatalogShell.svelte';
  import { Toast } from '$lib/components/ui/toast';
  import { store } from '$store/renderer/store';
  import { setThemeName } from '$store/renderer/slices/theme/theme-slice';
  import type { ThemeName } from '$store/renderer/slices/theme/theme-types';

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();

  const activeSlug = $derived((page.params as { slug?: string }).slug);
  const activePath = $derived(page.url.pathname);

  // Preview the resolved appearance for Redux consumers without requesting a saved
  // application preference change. Capture only the field this route owns.
  let priorThemeName: ThemeName | undefined;
  let previewThemeName: ThemeName | undefined;
  let ownsThemeName = false;
  let stopThemeWatch: (() => void) | undefined;
  function syncPreviewTheme(name: ThemeName) {
    // Observe transitions synchronously: a newer owner may change away and back
    // before unmount, so comparing only the final value would reclaim its state.
    stopThemeWatch ??= store.getReadableState().subscribe((state) => {
      if (state.theme.name !== previewThemeName) ownsThemeName = false;
    });
    if (!ownsThemeName) priorThemeName = store.state.theme.name;
    previewThemeName = name;
    ownsThemeName = true;
    store.dispatch(setThemeName(name));
  }
  onDestroy(() => {
    stopThemeWatch?.();
    if (ownsThemeName && priorThemeName !== undefined) {
      store.dispatch(setThemeName(priorThemeName));
    }
  });

  // The stylesheet rule below shares specificity with the token defaults, so which one wins
  // depends on stylesheet order. The inline declaration makes the bundled face win regardless;
  // CatalogShell only touches root inline properties it owns, so this survives theme updates.
  onMount(() => {
    const root = document.documentElement;
    const priorValue = root.style.getPropertyValue('--font-ui');
    const priorPriority = root.style.getPropertyPriority('--font-ui');
    root.style.setProperty(
      '--font-ui',
      "'Inter Variable', Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    );
    return () => {
      if (priorValue) root.style.setProperty('--font-ui', priorValue, priorPriority);
      else root.style.removeProperty('--font-ui');
    };
  });
</script>

<svelte:head>
  <title>Component sandbox</title>
</svelte:head>

<CatalogShell {activeSlug} {activePath} onThemeChange={syncPreviewTheme}
  >{@render children?.()}</CatalogShell
>
<Toast />

<style>
  :global(:root) {
    --font-ui:
      'Inter Variable', Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
</style>
