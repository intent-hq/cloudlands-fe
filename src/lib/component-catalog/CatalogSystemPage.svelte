<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { surfaceClasses } from '$lib/components/ui';

  let { slug }: { slug: 'motion' | 'sizes' | 'surfaces' | 'scrollbars' } = $props();
  let motionActive = $state(false);
  const springTiers = [
    ['fast', 'Hover, press, and focus feedback', '--spring-fast', '--spring-fast-exit'],
    ['moderate', 'Menus and compact disclosure', '--spring-moderate', '--spring-moderate-exit'],
    ['slow', 'Large panels and takeover transitions', '--spring-slow', '--spring-slow-exit'],
  ] as const;
  const sizes = [
    ['Compact', '--control-height-small', '28px'],
    ['Default', '--control-height-medium', '36px'],
    ['Large', '--control-height-large', '36px'],
  ] as const;
  const SURFACE_LEVELS = ([1, 2, 3, 4, 5, 6, 7, 8] as const).map((level) => ({
    level,
    className: surfaceClasses(level),
  }));
  const titles = {
    motion: ['Motion', 'Three spring speeds keep every interaction fast, legible, and related.'],
    sizes: ['Sizes', 'A compact control ladder keeps dense product interfaces aligned.'],
    surfaces: ['Surfaces', 'Eight shared levels express depth without inventing component colors.'],
    scrollbars: ['Scrollbars', 'Quiet scroll affordances appear when content needs them.'],
  } as const;
</script>

<article class="system-page" data-system-page={slug}>
  <header>
    <h1>{titles[slug][0]}</h1>
    <p>{titles[slug][1]}</p>
  </header>

  {#if slug === 'motion'}
    <section>
      <h2>Three speeds</h2>
      <p>Use the smallest spring that keeps the state change readable.</p>
      <div class="specimen-list">
        {#each springTiers as tier (tier[0])}
          <div class="spring-row">
            <strong>{tier[0]}</strong><span>{tier[1]}</span><code>{tier[2]} · {tier[3]}</code><i
              class:active={motionActive}
              style={`--tier:var(${tier[2]});--ease:var(${tier[2]}-ease)`}
            ></i>
          </div>
        {/each}
      </div>
      <Button
        variant="outline"
        aria-pressed={motionActive}
        onclick={() => (motionActive = !motionActive)}>Replay motion</Button
      >
    </section>
    <section>
      <h2>Reduced motion</h2>
      <p>
        The catalog's Make them yours panel can disable decorative movement while preserving state.
      </p>
    </section>
  {:else if slug === 'sizes'}
    <section>
      <h2>The principle</h2>
      <p>
        Use default controls for primary workflows and compact controls for dense supporting
        surfaces.
      </p>
      <div class="size-ladder">
        {#each sizes as size (size[0])}
          <div style={`height:var(${size[1]})`}>
            <strong>{size[0]}</strong><code>{size[1]}</code><span>{size[2]}</span>
          </div>
        {/each}
      </div>
    </section>
    <section>
      <h2>Typography scale</h2>
      <div class="type-scale">
        <span class="type-display">Intent design system</span><span class="type-title"
          >Section title</span
        ><span class="type-body">Readable interface copy</span><span class="type-caption"
          >Supporting metadata</span
        ><code>const size = 'compact';</code>
      </div>
    </section>
  {:else if slug === 'surfaces'}
    <section>
      <h2>The system</h2>
      <p>Each overlay rises two levels above its substrate, capped at level eight.</p>
      <div class="surface-ladder">
        {#each SURFACE_LEVELS as surface (surface.level)}
          <div class={surface.className}>
            <span>Surface {surface.level}</span><code>{surface.className}</code>
          </div>
        {/each}
      </div>
    </section>
    <section>
      <h2>Elevation</h2>
      <div class="elevation-demo">
        <div>Base content</div>
        <div>Raised panel</div>
        <div>Overlay</div>
      </div>
    </section>
  {:else}
    <section>
      <h2>Vertical</h2>
      <p>Keyboard-focusable scroll regions use the same quiet track and thumb treatment.</p>
      <ScrollArea class="scroll-demo h-64 rounded-(--radius-medium) border border-border p-4">
        <div class="grid gap-3">
          {#each Array.from({ length: 18 }, (_, index) => index + 1) as row}<div class="scroll-row">
              Scrollable row {row}
            </div>{/each}
        </div>
      </ScrollArea>
    </section>
    <section>
      <h2>Horizontal</h2>
      <ScrollArea
        orientation="horizontal"
        class="scroll-demo h-24 rounded-(--radius-medium) border border-border p-4"
        ><div class="flex w-max gap-3">
          {#each Array.from({ length: 12 }, (_, index) => index + 1) as column}<span
              class="scroll-chip">Column {column}</span
            >{/each}
        </div></ScrollArea
      >
    </section>
  {/if}
</article>

<style>
  .system-page {
    display: grid;
    width: 100%;
    min-width: 0;
    gap: 3rem;
    padding: 7rem 1.5rem;
  }
  .system-page header h1 {
    font-size: 1.75rem;
    font-weight: 400;
    line-height: 1;
  }
  .system-page header p,
  section > p {
    margin-top: 0.5rem;
    color: hsl(var(--muted-foreground));
    font-size: var(--text-caption-size);
    line-height: 1.6;
  }
  h2 {
    font-size: 1rem;
    font-weight: 400;
  }
  .specimen-list,
  .size-ladder,
  .type-scale {
    display: grid;
    gap: 0.75rem;
    margin-block: 1rem;
  }
  .spring-row {
    display: grid;
    grid-template-columns: 5rem 1fr auto;
    align-items: center;
    gap: 0.75rem;
    font-size: var(--text-caption-size);
  }
  .spring-row span,
  .spring-row code {
    color: hsl(var(--muted-foreground));
  }
  .spring-row i {
    grid-column: 1/-1;
    display: block;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 999px;
    background: hsl(var(--foreground));
    transition: transform var(--tier) var(--ease);
  }
  .spring-row i.active {
    transform: translateX(calc(100% - 0.75rem));
  }
  .size-ladder > div {
    display: grid;
    grid-template-columns: 6rem 1fr auto;
    align-items: center;
    padding-inline: 0.75rem;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-small);
    font-size: var(--text-caption-size);
  }
  .type-scale span,
  .type-scale code {
    display: block;
  }
  .surface-ladder {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.75rem;
    margin-top: 1rem;
  }
  .surface-ladder > div {
    display: grid;
    align-content: end;
    aspect-ratio: 1;
    padding: 0.625rem;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-medium);
    font-size: var(--text-caption-size);
  }
  .surface-ladder code {
    color: hsl(var(--muted-foreground));
  }
  .elevation-demo {
    display: flex;
    align-items: center;
    margin-top: 1rem;
  }
  .elevation-demo div {
    flex: 1;
    padding: 1.25rem;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-medium);
    background: hsl(var(--card));
    box-shadow: var(--elevation-raised);
  }
  .elevation-demo div + div {
    margin-left: -1rem;
    transform: translateY(0.75rem);
  }
  :global(.scroll-demo) {
    margin-top: 1rem;
  }
  .scroll-row,
  .scroll-chip {
    border-radius: var(--radius-small);
    background: hsl(var(--muted));
    padding: 0.625rem 0.75rem;
    font-size: var(--text-caption-size);
  }
  @media (max-width: 560px) {
    .surface-ladder {
      grid-template-columns: repeat(2, 1fr);
    }
    .spring-row {
      grid-template-columns: 1fr;
    }
    .spring-row i {
      grid-column: 1;
    }
  }
</style>
