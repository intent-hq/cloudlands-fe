<script lang="ts">
  import { canonicalComponentManifest } from '$lib/components/ui/manifest';
  import type { CatalogEntry } from './catalog';
  import { getCatalogRenderer } from './catalog-renderers';
  import ProposalCatalogPreview from './renderers/ProposalCatalogPreview.svelte';
  import ChatPolishCatalogPreview from './renderers/ChatPolishCatalogPreview.svelte';
  import ChatPolishGeometryControls from './ChatPolishGeometryControls.svelte';
  import {
    defaultChatPolishGeometry,
    type ChatPolishGeometry,
  } from './chat-polish/chat-polish-geometry';

  let { entry }: { entry: CatalogEntry } = $props();
  const metadata = $derived(canonicalComponentManifest.find(({ id }) => id === entry.slug));
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
            <h2>{fixture.title}</h2>
          </div>
        {/if}
        <div
          class="fixture-preview min-h-20 rounded-md bg-background"
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
                <dt>Viewport</dt>
                <dd class="mt-1 text-foreground">{fixture.viewport ?? 'responsive'}</dd>
              </div>
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
  class="catalog-detail w-full min-w-0 p-4 sm:p-6 lg:p-10"
  class:chat-polish-detail={entry.slug === 'chat-polish'}
>
  <header class="entry-header">
    <div class="min-w-0">
      <h1>{entry.name}</h1>
      <p class="entry-purpose">{entry.description}</p>
    </div>
    <details class="entry-inspector text-xs text-muted-foreground">
      <summary>Source</summary>
      <div class="inspector-popover">
        <p class="text-foreground">Canonical source</p>
        <code class="mt-1 block break-all">{entry.source}</code>
        <dl class="inspector-grid">
          <div>
            <dt>Category</dt>
            <dd class="mt-1 text-foreground">{entry.category}</dd>
          </div>
          {#if metadata}
            <div>
              <dt>Removal gate</dt>
              <dd class="mt-1 text-foreground">{metadata.removalGate}</dd>
            </div>
          {/if}
        </dl>
      </div>
    </details>
  </header>

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
  }

  h1 {
    font-size: var(--text-display-size);
    font-weight: var(--text-display-weight);
    line-height: var(--text-display-line-height);
    letter-spacing: var(--text-display-tracking);
  }

  h2 {
    font-size: var(--text-title-size);
    font-weight: var(--text-title-weight);
    line-height: var(--text-title-line-height);
    letter-spacing: var(--text-title-tracking);
  }

  .entry-purpose {
    margin-top: 0.5rem;
    color: hsl(var(--muted-foreground));
    font-size: var(--text-body-size);
    font-weight: var(--text-body-weight);
    line-height: var(--text-body-line-height);
    letter-spacing: var(--text-body-tracking);
  }

  .fixture-grid {
    display: grid;
    min-width: 0;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
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
  }

  .fixture-heading {
    display: flex;
    min-width: 0;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--catalog-row-gap);
  }

  .fixture-preview {
    min-width: 0;
    overflow-x: auto;
    padding: var(--catalog-preview-padding);
    background-color: hsl(var(--background));
  }

  summary {
    width: fit-content;
    cursor: pointer;
    border-radius: var(--radius-small);
    color: hsl(var(--primary-ink));
    font-size: var(--text-caption-size);
    font-weight: var(--text-body-strong-weight);
  }

  summary:hover {
    text-decoration: underline;
  }

  summary:focus-visible {
    outline: 1px solid hsl(var(--ring));
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
