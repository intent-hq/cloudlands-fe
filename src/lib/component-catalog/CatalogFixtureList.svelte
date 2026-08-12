<script lang="ts">
  import type { CatalogEntry } from './catalog';
  import { getCatalogRenderer } from './catalog-renderers';
  import ProposalCatalogPreview from './renderers/ProposalCatalogPreview.svelte';

  let { entry, mode = 'detail' }: { entry: CatalogEntry; mode?: 'gallery' | 'detail' } = $props();
  const renderer = $derived(getCatalogRenderer(entry.slug));
</script>

<section
  class={mode === 'gallery'
    ? 'catalog-entry scroll-mt-24 overflow-hidden rounded-lg border border-border bg-card'
    : 'catalog-detail mx-auto max-w-6xl p-4 sm:p-6 lg:p-10'}
  id={mode === 'gallery' ? `component-${entry.slug}` : undefined}
  data-catalog-gallery-entry={mode === 'gallery' ? entry.slug : undefined}
>
  <header class="entry-header border-b border-border">
    <div class="min-w-0">
      <div class="flex flex-wrap items-baseline gap-2">
        {#if mode === 'gallery'}
          <h3 class="text-lg font-medium tracking-tight">{entry.name}</h3>
        {:else}
          <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Component focus
          </p>
          <h1 class="mt-1 text-3xl font-medium tracking-tight">{entry.name}</h1>
        {/if}
        <span
          class="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
        >
          {entry.category}
        </span>
      </div>
      <p class="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
        {entry.description}
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      {#if mode === 'gallery'}
        <a class="focus-link" href={`/sandbox/${entry.slug}`}>Focus view</a>
      {/if}
      <details class="entry-inspector text-xs text-muted-foreground">
        <summary>Source</summary>
        <div class="inspector-popover">
          <p class="text-foreground">Canonical source</p>
          <code class="mt-1 block break-all">{entry.source}</code>
        </div>
      </details>
    </div>
  </header>

  <div class="fixture-grid">
    {#each entry.fixtures as fixture (fixture.id)}
      <article class="fixture-card" data-catalog-fixture={fixture.id}>
        <div class="fixture-heading">
          <h2 class="text-sm font-medium">{fixture.title}</h2>
          {#if fixture.viewport}
            <span
              class="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              {fixture.viewport}
            </span>
          {/if}
        </div>
        <div
          class="fixture-preview min-h-20 rounded-md border border-border bg-background"
          data-catalog-preview={entry.slug}
          data-catalog-fixture-id={fixture.id}
        >
          {#if entry.slug === 'proposal-card'}
            <ProposalCatalogPreview {fixture} />
          {:else if renderer}
            {@const Preview = renderer.component}
            <Preview componentId={renderer.id} {fixture} />
          {/if}
        </div>
        <details class="fixture-inspector text-xs text-muted-foreground">
          <summary>Fixture details</summary>
          <dl class="inspector-grid">
            <div>
              <dt>States</dt>
              <dd class="mt-1 text-foreground">{fixture.states.join(', ')}</dd>
            </div>
            <div>
              <dt>Themes</dt>
              <dd class="mt-1 text-foreground">{fixture.themes?.join(', ') ?? 'inherit'}</dd>
            </div>
          </dl>
        </details>
      </article>
    {/each}
  </div>
</section>

<style>
  .catalog-detail {
    display: grid;
    gap: calc(var(--control-height-medium) / 2);
  }

  .entry-header {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--catalog-row-gap);
    padding: calc(var(--catalog-preview-padding) * 1.25);
  }

  .catalog-detail > .entry-header {
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-large);
    background: hsl(var(--card));
  }

  .fixture-grid {
    display: grid;
    min-width: 0;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--catalog-row-gap);
    padding: var(--catalog-preview-padding);
  }

  .catalog-detail > .fixture-grid {
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-large);
    background: hsl(var(--background));
  }

  .fixture-card {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    gap: var(--catalog-row-gap);
    padding: var(--catalog-preview-padding);
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-large);
    background: hsl(var(--card));
    box-shadow: var(--elevation-raised);
  }

  .fixture-heading {
    display: flex;
    min-width: 0;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--catalog-row-gap);
  }

  .fixture-preview {
    padding: var(--catalog-preview-padding);
    background-color: hsl(var(--background));
    background-image: var(--surface-hatch);
  }

  summary,
  .focus-link {
    width: fit-content;
    cursor: pointer;
    border-radius: var(--radius-small);
    color: hsl(var(--primary));
    font-size: var(--text-caption-size);
    font-weight: var(--text-body-strong-weight);
  }

  summary:hover,
  .focus-link:hover {
    text-decoration: underline;
  }

  summary:focus-visible,
  .focus-link:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }

  .entry-inspector {
    position: relative;
  }

  .inspector-popover {
    position: absolute;
    z-index: var(--layer-popover);
    inset-inline-end: 0;
    width: min(18rem, calc(100vw - 2rem));
    margin-top: calc(var(--control-height-compact) / 3);
    padding: var(--catalog-preview-padding);
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-large);
    background: hsl(var(--popover));
    color: hsl(var(--popover-foreground));
    box-shadow: var(--elevation-overlay);
  }

  .fixture-inspector {
    padding-top: var(--catalog-row-gap);
    border-top: 1px solid hsl(var(--border));
  }

  .inspector-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--catalog-row-gap);
    margin-top: var(--catalog-row-gap);
  }

  @media (max-width: 639px) {
    .fixture-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .entry-header {
      flex-direction: column;
    }
  }
</style>
