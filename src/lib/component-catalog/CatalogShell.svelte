<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import CatalogControls from './CatalogControls.svelte';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import SizeProvider from '$lib/components/ui/SizeProvider.svelte';
  import { catalogEntries } from './catalog';
  import { catalogShowcaseEntries, catalogSystemEntries } from './catalog-navigation';
  import { themePresets } from '$lib/utils/theme-presets';
  import { parseVSCodeTheme } from '$lib/utils/vscode-theme-parser';
  import {
    defaultCatalogPreferences,
    parseCatalogUrlSettings,
    readCatalogPreferences,
    writeCatalogPreferences,
    type CatalogColorTheme,
    type CatalogTheme,
  } from './catalog-preferences';
  import { installPreviewBrowserApi } from './preview-discovery';

  let {
    activeSlug,
    activePath = '/sandbox',
    children,
  }: { activeSlug?: string; activePath?: string; children?: Snippet } = $props();
  let theme = $state<CatalogTheme>(defaultCatalogPreferences.theme);
  let colorTheme = $state<CatalogColorTheme>(defaultCatalogPreferences.colorTheme);
  let reducedMotion = $state(defaultCatalogPreferences.reducedMotion);
  let systemDark = $state(false);
  let hydrated = $state(false);
  let width = $state<number | undefined>(undefined);
  let density = $state<'default' | 'compact'>('default');
  let radius = $state<'rounded' | 'square'>('rounded');
  let initialRootDark = false;
  let initialRootLight = false;
  let initialRootReducedMotion = false;
  let initialRootStyle: string | null = null;

  const resolvedTheme = $derived(theme === 'system' ? (systemDark ? 'dark' : 'light') : theme);

  onMount(() => {
    const root = document.documentElement;
    initialRootDark = root.classList.contains('dark');
    initialRootLight = root.classList.contains('light');
    initialRootReducedMotion = root.classList.contains('catalog-reduced-motion');
    initialRootStyle = root.getAttribute('style');
    const saved = readCatalogPreferences(localStorage);
    const urlSettings = parseCatalogUrlSettings(new URLSearchParams(window.location.search));
    theme = urlSettings.theme ?? saved.theme;
    colorTheme = saved.colorTheme;
    reducedMotion = urlSettings.reducedMotion ?? saved.reducedMotion;
    width = urlSettings.width;
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

    if (activeSlug) {
      const url = new URL(window.location.href);
      url.searchParams.set('theme', theme);
      url.searchParams.set('motion', reducedMotion ? 'reduced' : 'full');
      if (width) url.searchParams.set('width', String(width));
      else url.searchParams.delete('width');
      window.history.replaceState(window.history.state, '', url);
    }
  });
</script>

<div
  class="catalog-shell min-h-screen bg-background text-foreground"
  data-testid="catalog-shell"
  data-catalog-theme={theme}
  data-catalog-color-theme={colorTheme}
  data-catalog-motion={reducedMotion ? 'reduced' : 'full'}
  data-catalog-density={density}
  data-catalog-radius={radius}
  style={`${radius === 'square' ? '--radius-small:2px;--radius-medium:3px;--radius-large:4px;' : ''}${width ? `--catalog-preview-width:${width}px` : ''}`}
>
  {#key density}
    <SizeProvider size={density}>
      <Sidebar.Provider open persist={false} width="256px" class="catalog-layout">
        <Sidebar.Root collapsible="none" rail={false} class="catalog-sidebar">
          <Sidebar.Header class="catalog-sidebar-header">
            <a class="catalog-brand" href="/sandbox" aria-label="Component catalog home">
              <span class="brand-mark" aria-hidden="true">I</span>
              <span>Intent UI</span>
            </a>
          </Sidebar.Header>
          <Sidebar.Content class="catalog-sidebar-content">
            <Sidebar.Group>
              <Sidebar.GroupLabel>Showcase</Sidebar.GroupLabel>
              <Sidebar.GroupContent>
                <Sidebar.Menu>
                  {#each catalogShowcaseEntries as entry (entry.slug)}
                    <Sidebar.MenuItem>
                      <Sidebar.MenuButton
                        isActive={entry.slug === 'introduction'
                          ? activePath === '/sandbox'
                          : activePath.startsWith(entry.href)}
                      >
                        {#snippet child({ props })}
                          <a {...props} href={entry.href}>{entry.name}</a>
                        {/snippet}
                      </Sidebar.MenuButton>
                    </Sidebar.MenuItem>
                  {/each}
                </Sidebar.Menu>
              </Sidebar.GroupContent>
            </Sidebar.Group>
            <Sidebar.Group>
              <Sidebar.GroupLabel
                >System <span>{catalogSystemEntries.length}</span></Sidebar.GroupLabel
              >
              <Sidebar.GroupContent>
                <Sidebar.Menu>
                  {#each catalogSystemEntries as entry (entry.slug)}
                    <Sidebar.MenuItem>
                      <Sidebar.MenuButton isActive={activeSlug === entry.slug}>
                        {#snippet child({ props })}
                          <a {...props} href={entry.href}>{entry.name}</a>
                        {/snippet}
                      </Sidebar.MenuButton>
                    </Sidebar.MenuItem>
                  {/each}
                </Sidebar.Menu>
              </Sidebar.GroupContent>
            </Sidebar.Group>
            <Sidebar.Group>
              <Sidebar.GroupLabel
                >Components <span>{catalogEntries.length}</span></Sidebar.GroupLabel
              >
              <Sidebar.GroupContent>
                <Sidebar.Menu>
                  {#each catalogEntries as entry (entry.slug)}
                    <Sidebar.MenuItem>
                      <Sidebar.MenuButton isActive={activeSlug === entry.slug}>
                        {#snippet child({ props })}
                          <a {...props} href={`/sandbox/${entry.slug}`}>{entry.name}</a>
                        {/snippet}
                      </Sidebar.MenuButton>
                    </Sidebar.MenuItem>
                  {/each}
                </Sidebar.Menu>
              </Sidebar.GroupContent>
            </Sidebar.Group>
          </Sidebar.Content>
        </Sidebar.Root>
        <main class="catalog-main">{@render children?.()}</main>
        <aside class="catalog-customize" aria-label="Catalog customization">
          <CatalogControls
            bind:theme
            bind:colorTheme
            {resolvedTheme}
            bind:reducedMotion
            bind:width
            bind:density
            bind:radius
          />
        </aside>
      </Sidebar.Provider>
    </SizeProvider>
  {/key}
</div>

<style>
  .catalog-shell {
    --catalog-preview-padding: calc(var(--control-height-medium) / 2);
    --catalog-row-gap: calc(var(--control-height-small) / 2);
    font-family: var(--font-ui);
    overflow-x: clip;
  }

  :global(.catalog-layout) {
    display: grid;
    grid-template-columns: 256px minmax(0, 1fr) 256px;
    align-items: start;
    min-height: 100svh;
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
    color: hsl(var(--primary-ink, var(--primary-foreground)));
    font-size: var(--text-caption-size);
    box-shadow: var(--elevation-raised);
  }

  :global(.catalog-sidebar) {
    position: sticky;
    top: 0;
    height: 100svh;
    border-right: 0;
  }

  :global(.catalog-sidebar-header) {
    padding: 1rem 1rem 0.5rem;
  }

  :global(.catalog-sidebar-content) {
    padding: 0 0.5rem 1rem;
  }

  :global(.catalog-sidebar [data-sidebar='group']) {
    padding-block: 0.375rem;
  }

  :global(.catalog-sidebar [data-sidebar='group-label']) {
    display: flex;
    justify-content: space-between;
  }

  .catalog-main {
    min-width: 0;
    overflow-x: clip;
  }

  .catalog-customize {
    position: sticky;
    top: 1rem;
    padding: 1rem;
  }

  @media (max-width: 1199px) {
    :global(.catalog-layout) {
      grid-template-columns: 256px minmax(0, 1fr);
    }

    .catalog-customize {
      display: none;
    }
  }

  @media (max-width: 767px) {
    :global(.catalog-layout) {
      display: block;
    }

    :global(.catalog-sidebar) {
      position: static;
      width: 100%;
      height: auto;
      max-height: 18rem;
      border-bottom: 1px solid hsl(var(--border));
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
