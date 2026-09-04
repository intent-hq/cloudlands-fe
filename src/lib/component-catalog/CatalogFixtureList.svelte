<script lang="ts">
  import type { CatalogEntry } from './catalog';
  import { m } from '$shared/paraglide/messages.js';
  import { getCatalogRenderer } from './catalog-renderers';
  import ProposalCatalogPreview from './renderers/ProposalCatalogPreview.svelte';
  import ChatPolishCatalogPreview from './renderers/ChatPolishCatalogPreview.svelte';
  import ChatPolishGeometryControls from './ChatPolishGeometryControls.svelte';
  import {
    defaultChatPolishGeometry,
    type ChatPolishGeometry,
  } from './chat-polish/chat-polish-geometry';

  let { entry, mode = 'detail' }: { entry: CatalogEntry; mode?: 'gallery' | 'detail' } = $props();
  const renderer = $derived(getCatalogRenderer(entry.slug));
  let chatPolishGeometry = $state<ChatPolishGeometry>({ ...defaultChatPolishGeometry });
  const visibleFixtures = $derived(
    entry.slug === 'chat-polish' ? entry.fixtures.slice(0, 1) : entry.fixtures,
  );
  const chatPolishStyle = $derived(
    [
      `--chat-polish-panel-width:${chatPolishGeometry.panelWidth}px`,
      `--chat-polish-content-inset:${chatPolishGeometry.contentInset}px`,
      `--chat-polish-user-bottom-gap:${chatPolishGeometry.userMessageBottomGap}px`,
      `--chat-operational-row-gap:${chatPolishGeometry.operationalRowGap}px`,
      `--chat-operational-text-gap:${chatPolishGeometry.operationalTextGap}px`,
      `--chat-polish-thinking-top-gap:${chatPolishGeometry.thinkingTopGap}px`,
      `--chat-polish-wake-top-gap:${chatPolishGeometry.wakeTopGap}px`,
      `--chat-polish-wake-bottom-gap:${chatPolishGeometry.wakeBottomGap}px`,
      `--chat-polish-subscription-bottom-gap:${chatPolishGeometry.subscriptionBottomGap}px`,
      `--chat-polish-row-padding:${chatPolishGeometry.rowPadding}px`,
      `--chat-polish-card-radius:${chatPolishGeometry.cardRadius}px`,
      `--chat-polish-failure-notice-top-gap:${chatPolishGeometry.failureNoticeTopGap}px`,
      `--chat-polish-failure-notice-bottom-gap:${chatPolishGeometry.failureNoticeBottomGap}px`,
    ].join(';'),
  );
</script>

{#snippet fixtureGrid()}
  <div
    class="fixture-grid"
    class:chat-polish-workbench={entry.slug === 'chat-polish'}
    data-testid={entry.slug === 'chat-polish' ? 'chat-polish-workbench' : undefined}
    data-compact={entry.slug === 'chat-polish' ? chatPolishGeometry.compact : undefined}
    style={entry.slug === 'chat-polish' ? chatPolishStyle : undefined}
  >
    {#each visibleFixtures as fixture (fixture.id)}
      <article class="fixture-card" data-catalog-fixture={fixture.id}>
        {#if entry.slug !== 'chat-polish'}
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
        {/if}
        <div
          class="fixture-preview min-h-20 rounded-md border border-border bg-background"
          data-catalog-preview={entry.slug}
          data-catalog-fixture-id={fixture.id}
        >
          {#if entry.slug === 'proposal-card'}
            <ProposalCatalogPreview {fixture} />
          {:else if entry.slug === 'chat-polish'}
            <ChatPolishCatalogPreview
              {fixture}
              compact={chatPolishGeometry.compact}
              stickySimulation={chatPolishGeometry.stickySimulation}
            />
          {:else if entry.slug === 'new-workspace'}
            <a class="focus-link m-4 inline-flex" href="/sandbox/new-workspace">
              {m.sandbox_newWorkspace_openRegistry_label()}
            </a>
          {:else if renderer}
            {@const Preview = renderer.component}
            <Preview componentId={renderer.id} {fixture} />
          {/if}
        </div>
        {#if entry.slug !== 'chat-polish'}
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
        {/if}
      </article>
    {/each}
  </div>
{/snippet}

<section
  class={mode === 'gallery'
    ? 'catalog-entry scroll-mt-24 overflow-hidden rounded-lg border border-border bg-card'
    : 'catalog-detail mx-auto max-w-6xl p-4 sm:p-6 lg:p-10'}
  class:chat-polish-detail={entry.slug === 'chat-polish' && mode === 'detail'}
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

  {#if entry.slug !== 'chat-polish' || mode === 'detail'}
    {#if entry.slug === 'chat-polish'}
      <div class="chat-polish-layout" data-testid="chat-polish-layout">
        <aside class="chat-polish-sidebar" data-testid="chat-polish-sidebar">
          <ChatPolishGeometryControls bind:geometry={chatPolishGeometry} />
        </aside>
        <section
          class="chat-polish-examples"
          aria-label="Chat transcript examples"
          data-testid="chat-polish-examples"
        >
          {@render fixtureGrid()}
        </section>
      </div>
    {:else}
      {@render fixtureGrid()}
    {/if}
  {/if}
</section>

<style>
  .catalog-detail {
    display: grid;
    gap: calc(var(--control-height-medium) / 2);
  }

  .catalog-detail.chat-polish-detail {
    max-width: 100rem;
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

  .fixture-grid.chat-polish-workbench {
    grid-template-columns: repeat(
      auto-fit,
      minmax(
        min(100%, calc(var(--chat-polish-panel-width) + 2 * var(--catalog-preview-padding))),
        1fr
      )
    );
  }

  .chat-polish-layout {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(15rem, 18rem) minmax(0, 1fr);
    gap: var(--catalog-row-gap);
    align-items: start;
  }

  .chat-polish-sidebar {
    position: sticky;
    top: var(--catalog-row-gap);
    min-width: 0;
    min-height: 0;
    max-height: calc(100dvh - 2 * var(--catalog-row-gap));
    overflow-y: auto;
    overscroll-behavior-y: contain;
    scrollbar-gutter: stable;
  }

  .chat-polish-examples {
    min-width: 0;
  }

  .catalog-detail .chat-polish-examples > .fixture-grid {
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-large);
    background: hsl(var(--background));
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

  @media (max-width: 899px) {
    .chat-polish-layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .chat-polish-sidebar {
      position: static;
      max-height: none;
      overflow-y: visible;
      overscroll-behavior-y: auto;
      scrollbar-gutter: auto;
    }
  }
</style>
