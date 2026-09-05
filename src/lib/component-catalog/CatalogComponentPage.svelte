<script lang="ts">
  import * as Tabs from '$lib/components/ui/tabs';
  import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
  import type { CatalogEntry } from './catalog';
  import { getCatalogRenderer } from './catalog-renderers';
  import ChatPolishGeometryControls from './ChatPolishGeometryControls.svelte';
  import ChatPolishCatalogPreview from './renderers/ChatPolishCatalogPreview.svelte';
  import ProposalCatalogPreview from './renderers/ProposalCatalogPreview.svelte';
  import {
    defaultChatPolishGeometry,
    type ChatPolishGeometry,
  } from './chat-polish/chat-polish-geometry';

  let { entry }: { entry: CatalogEntry } = $props();
  let tab = $state('preview');
  let chatPolishGeometry = $state<ChatPolishGeometry>({ ...defaultChatPolishGeometry });
  const renderer = $derived(getCatalogRenderer(entry.slug));
  const fixtures = $derived(
    entry.slug === 'chat-polish' ? entry.fixtures.slice(0, 1) : entry.fixtures,
  );
  const componentName = $derived(entry.exports?.[0] ?? entry.name.replaceAll(' ', ''));
  const installCommand = $derived(
    entry.publicImport ? `import { ${componentName} } from '${entry.publicImport}';` : entry.source,
  );
  const fixtureSource = $derived(
    `<script lang="ts">\n  ${installCommand}\n<\/script>\n\n<${componentName} />`,
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
    ].join(';'),
  );
</script>

{#snippet preview(fixture: UiComponentFixture)}
  <div
    class="fixture-preview"
    data-catalog-preview={entry.slug}
    data-catalog-fixture-id={fixture.id}
    style={entry.slug === 'chat-polish' ? chatPolishStyle : undefined}
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
{/snippet}

{#snippet propsTable(label: string)}
  <div class="table-scroll">
    <table aria-label={label}>
      <thead>
        <tr><th>Prop</th><th>Type</th><th>Default</th><th>Description</th></tr>
      </thead>
      <tbody>
        {#each entry.props ?? [] as prop (prop.name)}
          <tr>
            <td><code>{prop.name}</code></td>
            <td><code>{prop.type}</code></td>
            <td><code>{prop.defaultValue}</code></td>
            <td>{prop.description}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/snippet}

<article class="component-page" data-testid="catalog-component-page">
  <header class="page-header">
    <h1>{entry.name}</h1>
    <p>{entry.description}</p>
  </header>

  <section aria-labelledby="installation-title">
    <h2 id="installation-title">Installation</h2>
    <code class="install-command">{installCommand}</code>
  </section>

  <section aria-labelledby="playground-title">
    <h2 id="playground-title">Playground</h2>
    <Tabs.Root bind:value={tab} class="playground">
      <Tabs.List class="playground-tabs">
        <Tabs.Trigger value="preview">Preview</Tabs.Trigger>
        <Tabs.Trigger value="code">Code</Tabs.Trigger>
        <Tabs.Trigger value="inspect">Inspect</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="preview">
        {#if entry.slug === 'chat-polish'}
          <div class="chat-polish-layout" data-testid="chat-polish-layout">
            <ChatPolishGeometryControls bind:geometry={chatPolishGeometry} />
            {@render preview(fixtures[0])}
          </div>
        {:else}
          {@render preview(fixtures[0])}
        {/if}
      </Tabs.Content>
      <Tabs.Content value="code"><pre><code>{fixtureSource}</code></pre></Tabs.Content>
      <Tabs.Content value="inspect"
        >{@render propsTable(`${entry.name} playground props`)}</Tabs.Content
      >
    </Tabs.Root>
  </section>

  {#each fixtures.slice(1) as fixture (fixture.id)}
    <section data-catalog-fixture={fixture.id}>
      <h2>{fixture.title}</h2>
      <p class="section-description">
        Explore {fixture.states.join(', ')} states across {fixture.viewport ?? 'responsive'} layouts.
      </p>
      <div class="section-preview">{@render preview(fixture)}</div>
    </section>
  {/each}

  <section aria-labelledby="api-title">
    <h2 id="api-title">API Reference</h2>
    {@render propsTable(`${entry.name} API reference`)}
  </section>
</article>

<style>
  .component-page {
    display: grid;
    min-width: 0;
    grid-template-columns: minmax(0, 1fr);
    width: 100%;
    max-width: 680px;
    gap: 2rem;
    margin-inline: auto;
    padding: 7rem 1.5rem;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 400;
    line-height: 1;
    letter-spacing: -0.025em;
  }

  h2 {
    margin-bottom: 0.75rem;
    font-size: 1rem;
    font-weight: 400;
    line-height: 1;
  }

  .page-header p,
  .section-description {
    margin-top: 0.5rem;
    color: hsl(var(--muted-foreground));
    font-size: var(--text-caption-size);
    line-height: 1.5;
  }

  .install-command {
    display: block;
    overflow-x: auto;
    border-radius: var(--radius-medium);
    background: hsl(var(--muted));
    padding: 0.625rem 0.75rem;
    color: hsl(var(--muted-foreground));
    font-size: var(--text-caption-size);
  }

  :global(.playground) {
    display: block;
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-medium);
  }

  :global(.playground-tabs) {
    display: flex;
    width: 100%;
    min-height: 2.25rem;
    padding: 0.25rem;
    border-bottom: 1px solid hsl(var(--border));
  }

  .fixture-preview,
  .section-preview {
    width: min(100%, var(--catalog-preview-width, 100%));
    min-height: 8rem;
    margin-inline: auto;
    padding: 1.5rem;
    background: hsl(var(--background));
  }

  .section-preview {
    margin-top: 0.75rem;
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-medium);
    padding: 0;
  }

  pre {
    min-height: 8rem;
    overflow-x: auto;
    padding: 1rem;
    background: hsl(var(--muted));
    font-size: var(--text-caption-size);
  }

  .table-scroll {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-caption-size);
  }

  th,
  td {
    padding: 0.625rem 0.5rem;
    border-bottom: 1px solid hsl(var(--border));
    text-align: left;
    vertical-align: top;
  }

  th {
    color: hsl(var(--muted-foreground));
    font-weight: 500;
  }

  .chat-polish-layout {
    display: grid;
    gap: 0.75rem;
  }

  @media (max-width: 1199px) {
    .component-page {
      padding-block: 2rem;
    }
  }
</style>
