<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import CatalogControls from './CatalogControls.svelte';
  import { themePresets } from '$lib/utils/theme-presets';
  import { parseVSCodeTheme } from '$lib/utils/vscode-theme-parser';
  import {
    defaultCatalogPreferences,
    parseCatalogUrlSettings,
    readCatalogPreferences,
    writeCatalogPreferences,
    type CatalogColorTheme,
    type CatalogPreviewFit,
    type CatalogTheme,
  } from './catalog-preferences';
  import { installPreviewBrowserApi } from './preview-discovery';

  let { activeSlug, children }: { activeSlug?: string; children?: Snippet } = $props();
  let theme = $state<CatalogTheme>(defaultCatalogPreferences.theme);
  let colorTheme = $state<CatalogColorTheme>(defaultCatalogPreferences.colorTheme);
  let reducedMotion = $state(defaultCatalogPreferences.reducedMotion);
  let fit = $state<CatalogPreviewFit>();
  let systemDark = $state(false);
  let hydrated = $state(false);
  let initialRootDark = false;
  let initialRootLight = false;
  let initialRootReducedMotion = false;
  let initialRootComponentFit = false;
  let initialRootStyle: string | null = null;

  const resolvedTheme = $derived(theme === 'system' ? (systemDark ? 'dark' : 'light') : theme);

  onMount(() => {
    const root = document.documentElement;
    initialRootDark = root.classList.contains('dark');
    initialRootLight = root.classList.contains('light');
    initialRootReducedMotion = root.classList.contains('catalog-reduced-motion');
    initialRootComponentFit = root.classList.contains('catalog-component-fit');
    initialRootStyle = root.getAttribute('style');
    const saved = readCatalogPreferences(localStorage);
    const urlSettings = parseCatalogUrlSettings(new URLSearchParams(window.location.search));
    theme = urlSettings.theme ?? saved.theme;
    colorTheme = saved.colorTheme;
    reducedMotion = urlSettings.reducedMotion ?? saved.reducedMotion;
    fit = urlSettings.fit;
    const removePreviewBrowserApi = installPreviewBrowserApi(window);

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const updateSystemTheme = () => (systemDark = media.matches);
    updateSystemTheme();
    media.addEventListener('change', updateSystemTheme);
    hydrated = true;
    return () => {
      media.removeEventListener('change', updateSystemTheme);
      removePreviewBrowserApi();
      root.classList.toggle('dark', initialRootDark);
      root.classList.toggle('light', initialRootLight);
      root.classList.toggle('catalog-reduced-motion', initialRootReducedMotion);
      root.classList.toggle('catalog-component-fit', initialRootComponentFit);
      if (initialRootStyle === null) root.removeAttribute('style');
      else root.setAttribute('style', initialRootStyle);
    };
  });

  $effect(() => {
    if (!hydrated) return;
    writeCatalogPreferences(localStorage, { theme, colorTheme, reducedMotion });
    const root = document.documentElement;
    if (initialRootStyle === null) root.removeAttribute('style');
    else root.setAttribute('style', initialRootStyle);
    const preset = themePresets.find(({ id }) => id === colorTheme);
    if (preset) {
      const parsedTheme = parseVSCodeTheme(preset[resolvedTheme]);
      for (const [property, value] of Object.entries(parsedTheme.cssVariables)) {
        root.style.setProperty(property, value);
      }
    }
    root.style.colorScheme = resolvedTheme;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.classList.toggle('light', resolvedTheme === 'light');
    root.classList.toggle('catalog-reduced-motion', reducedMotion);
    root.classList.toggle('catalog-component-fit', fit === 'component');

    if (activeSlug) {
      const url = new URL(window.location.href);
      url.searchParams.set('theme', theme);
      url.searchParams.set('motion', reducedMotion ? 'reduced' : 'full');
      window.history.replaceState(window.history.state, '', url);
    }
  });
</script>

<div
  class:component-fit={fit === 'component'}
  class="catalog-shell min-h-screen bg-background text-foreground"
  data-testid="catalog-shell"
  data-catalog-theme={theme}
  data-catalog-color-theme={colorTheme}
  data-catalog-motion={reducedMotion ? 'reduced' : 'full'}
>
  <div class="catalog-shell-content min-h-screen w-full min-w-0">
    {#if fit !== 'component'}
      <header class="catalog-topbar sticky top-0 border-b border-border bg-card/95 backdrop-blur">
        <div class="catalog-topbar-inner mx-auto max-w-[1680px] px-4 py-2 sm:px-6">
          <div class="flex min-w-0 items-center gap-3">
            <a class="catalog-brand" href="/sandbox" aria-label="Component catalog home">
              <span class="brand-mark" aria-hidden="true">DS</span>
              <span class="truncate text-sm font-medium">Design system</span>
            </a>
            {#if activeSlug}
              <a
                class="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href="/sandbox">View all</a
              >
            {/if}
          </div>
          <CatalogControls bind:theme bind:colorTheme {resolvedTheme} bind:reducedMotion />
        </div>
      </header>
    {/if}
    <main class="min-w-0 overflow-x-clip">{@render children?.()}</main>
  </div>
</div>

<style>
  .catalog-shell {
    --catalog-preview-padding: calc(var(--control-height-medium) / 2);
    --catalog-row-gap: calc(var(--control-height-small) / 2);
    font-family: var(--font-ui);
    overflow-x: clip;
  }

  .catalog-shell.component-fit,
  .component-fit .catalog-shell-content {
    width: max-content;
    min-height: 0;
  }

  .component-fit main {
    display: contents;
  }

  :global(html.catalog-component-fit),
  :global(html.catalog-component-fit body) {
    width: max-content;
    min-width: 0;
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow: visible;
  }

  .catalog-topbar {
    z-index: var(--layer-chrome);
    box-shadow: var(--elevation-raised);
  }

  .catalog-topbar-inner {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: calc(var(--control-height-small) / 2);
  }

  .catalog-brand {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: calc(var(--control-height-compact) / 3);
    border-radius: var(--radius-medium);
  }

  .catalog-brand:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }

  .brand-mark {
    display: inline-flex;
    width: var(--control-height-small);
    height: var(--control-height-small);
    flex: none;
    align-items: center;
    justify-content: center;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-medium);
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    font-size: var(--text-caption-size);
    box-shadow: var(--elevation-raised);
  }

  @media (max-width: 767px) {
    .catalog-topbar-inner {
      align-items: flex-start;
      flex-direction: column;
    }
  }

  :global(html.catalog-reduced-motion *),
  :global(html.catalog-reduced-motion *::before),
  :global(html.catalog-reduced-motion *::after) {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
</style>
