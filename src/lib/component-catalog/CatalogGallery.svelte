<script lang="ts">
  import { onMount } from 'svelte';
  import { Input } from '$lib/components/ui/input';
  import { Select } from '$lib/components/ui/select';
  import CatalogFoundations from './CatalogFoundations.svelte';
  import CatalogFixtureList from './CatalogFixtureList.svelte';
  import { catalogEntries } from './catalog';
  import { buildCatalogGroups } from './catalog-navigation';
  import { catalogRendererIds } from './catalog-renderers';

  const renderableEntries = catalogEntries.filter(
    (entry) =>
      entry.slug === 'proposal-card' ||
      entry.slug === 'chat-polish' ||
      entry.slug === 'new-workspace' ||
      catalogRendererIds.includes(entry.slug as (typeof catalogRendererIds)[number]),
  );
  const groups = buildCatalogGroups(renderableEntries);
  const groupItems = [
    { value: 'all', label: 'All sections' },
    { value: 'foundations', label: 'Foundations' },
    ...groups.map((item) => ({ value: item.id, label: item.name })),
  ];
  let search = $state('');
  let group = $state('all');
  let activeAnchor = $state('');
  const normalizedSearch = $derived(search.trim().toLowerCase());
  const showFoundations = $derived(
    (group === 'all' || group === 'foundations') &&
      (!normalizedSearch ||
        'foundations semantic tokens typography spacing radii elevation motion layers'.includes(
          normalizedSearch,
        )),
  );
  const visibleGroups = $derived(
    groups
      .filter((item) => group === 'all' || item.id === group)
      .map((item) => ({
        ...item,
        entries: item.entries.filter((entry) =>
          `${entry.name} ${entry.slug} ${entry.description}`
            .toLowerCase()
            .includes(normalizedSearch),
        ),
      }))
      .filter((item) => item.entries.length > 0),
  );

  onMount(() => {
    const updateAnchor = () => (activeAnchor = window.location.hash.replace('#', ''));
    updateAnchor();
    window.addEventListener('hashchange', updateAnchor);
    return () => window.removeEventListener('hashchange', updateAnchor);
  });
</script>

<section class="mx-auto min-w-0 max-w-[1680px]" data-testid="catalog-gallery">
  <header class="catalog-intro border-b border-border px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
    <div class="max-w-3xl">
      <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Interface library
      </p>
      <h1 class="mt-2 text-3xl font-medium tracking-tight sm:text-4xl">Design system workspace</h1>
      <p class="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
        Explore live semantic foundations and host-independent canonical components across themes,
        densities, states, and responsive contexts.
      </p>
    </div>
  </header>

  <div class="catalog-workspace min-w-0">
    <aside class="catalog-rail min-w-0 border-border bg-sidebar text-sidebar-foreground">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <label class="grid gap-1 text-xs font-medium text-muted-foreground">
          Search components
          <Input
            bind:value={search}
            data-testid="catalog-search"
            type="search"
            placeholder="Name or role"
            aria-label="Search components"
            class="h-8 bg-card px-2"
          />
        </label>
        <label class="grid gap-1 text-xs font-medium text-muted-foreground">
          Group
          <Select.Root bind:value={group} items={groupItems}>
            <Select.Trigger
              aria-label="Group"
              data-testid="catalog-group-filter"
              class="h-8 px-2 py-1"
            >
              <Select.Value placeholder="All sections" />
            </Select.Trigger>
            <Select.Content portal>
              {#each groupItems as item (item.value)}
                <Select.Item value={item.value} label={item.label}>{item.label}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </label>
      </div>
      <nav class="catalog-index" aria-label="Catalog navigation">
        {#if showFoundations}
          <div class="shrink-0">
            <p class="catalog-group-label">System</p>
            <a
              class:catalog-link-active={activeAnchor === 'foundations'}
              class="catalog-link"
              href="#foundations"
              aria-current={activeAnchor === 'foundations' ? 'location' : undefined}
              onclick={() => (activeAnchor = 'foundations')}>Foundations</a
            >
          </div>
        {/if}
        {#each visibleGroups as item (item.id)}
          <div class="shrink-0">
            <p class="catalog-group-label">{item.name}</p>
            <div class="catalog-link-list">
              {#each item.entries as entry (entry.slug)}
                <a
                  class:catalog-link-active={activeAnchor === `component-${entry.slug}`}
                  class="catalog-link"
                  href={`#component-${entry.slug}`}
                  aria-current={activeAnchor === `component-${entry.slug}` ? 'location' : undefined}
                  onclick={() => (activeAnchor = `component-${entry.slug}`)}>{entry.name}</a
                >
              {/each}
            </div>
          </div>
        {/each}
      </nav>
    </aside>

    <div class="catalog-canvas min-w-0 bg-background px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      {#if showFoundations}
        <CatalogFoundations />
      {/if}
      {#each visibleGroups as item (item.id)}
        <section class="component-group space-y-5" data-catalog-group={item.id}>
          <h2
            class="border-b border-border pb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            {item.name}
          </h2>
          {#each item.entries as entry (entry.slug)}
            <CatalogFixtureList {entry} mode="gallery" />
          {/each}
        </section>
      {/each}
      {#if visibleGroups.length === 0 && !showFoundations}
        <p
          class="rounded-lg border border-dashed border-border bg-muted/30 p-10 text-center text-sm text-muted-foreground"
        >
          No catalog entries match this filter.
        </p>
      {/if}
    </div>
  </div>
</section>

<style>
  .catalog-intro {
    background: hsl(var(--background));
  }

  .catalog-workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .catalog-rail {
    padding: calc(var(--control-height-medium) / 2);
    border-bottom-width: 1px;
  }

  .catalog-index {
    display: flex;
    width: 100%;
    max-width: 100%;
    gap: calc(var(--control-height-small) / 2);
    margin-top: calc(var(--control-height-medium) / 2);
    padding-bottom: calc(var(--control-height-compact) / 4);
    overflow-x: auto;
  }

  .catalog-group-label {
    display: none;
    margin-bottom: calc(var(--control-height-compact) / 4);
    color: hsl(var(--muted-foreground));
    font-size: var(--text-caption-size);
    font-weight: var(--text-body-strong-weight);
  }

  .catalog-link-list {
    display: flex;
    gap: calc(var(--control-height-compact) / 6);
  }

  .catalog-link {
    display: block;
    white-space: nowrap;
    border-radius: var(--radius-medium);
    padding: calc(var(--control-height-compact) / 4) calc(var(--control-height-compact) / 3);
    color: hsl(var(--sidebar-foreground));
    font-size: var(--text-body-size);
    transition: background-color var(--motion-fast) var(--ease-standard);
  }

  .catalog-link:hover,
  .catalog-link-active {
    background: hsl(var(--sidebar-accent));
    color: hsl(var(--sidebar-accent-foreground));
  }

  .catalog-link:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }

  .component-group {
    margin-top: calc(var(--control-height-large) * 1.5);
  }

  @media (min-width: 1024px) {
    .catalog-workspace {
      grid-template-columns: 15rem minmax(0, 1fr);
      align-items: start;
    }

    .catalog-rail {
      position: sticky;
      top: calc(var(--control-height-large) + var(--control-height-compact));
      max-height: calc(100vh - var(--control-height-large) - var(--control-height-compact));
      align-self: start;
      padding: var(--control-height-small);
      border-right-width: 1px;
      border-bottom-width: 0;
      overflow-y: auto;
    }

    .catalog-index,
    .catalog-link-list {
      display: flex;
      flex-direction: column;
    }

    .catalog-index {
      gap: calc(var(--control-height-medium) / 2);
      overflow: visible;
    }

    .catalog-group-label {
      display: block;
    }

    .catalog-link {
      white-space: normal;
    }
  }
</style>
