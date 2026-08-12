<script lang="ts">
  import { onMount } from 'svelte';

  const colorRoles = [
    ['--background', 'Canvas'],
    ['--foreground', 'Primary text'],
    ['--card', 'Raised surface'],
    ['--popover', 'Overlay surface'],
    ['--primary', 'Primary action'],
    ['--secondary', 'Secondary action'],
    ['--accent', 'Selection'],
    ['--muted', 'Quiet surface'],
    ['--border', 'Boundary'],
    ['--ring', 'Focus'],
    ['--sidebar', 'Navigation chrome'],
    ['--sidebar-accent', 'Navigation selection'],
  ] as const;
  const typographyStyles = [
    {
      id: 'display',
      name: 'Display',
      className: 'type-display',
      use: 'Page and feature headings',
      sample: 'Build calmer, clearer tools',
      tokens: ['--text-display-size', '--text-display-line-height', '--text-display-weight'],
    },
    {
      id: 'title',
      name: 'Title',
      className: 'type-title',
      use: 'Sections, dialogs, and cards',
      sample: 'Design decisions stay visible',
      tokens: ['--text-title-size', '--text-title-line-height', '--text-title-weight'],
    },
    {
      id: 'body',
      name: 'Body',
      className: 'type-body',
      use: 'Messages, controls, and suggestions',
      sample: 'Readable by default across the entire interface.',
      tokens: ['--text-body-size', '--text-body-line-height', '--text-body-weight'],
    },
    {
      id: 'caption',
      name: 'Caption',
      className: 'type-caption',
      use: 'Short metadata and compact labels only',
      sample: 'Updated a moment ago',
      tokens: ['--text-caption-size', '--text-caption-line-height', '--text-caption-weight'],
    },
    {
      id: 'code',
      name: 'Code',
      className: 'type-code',
      use: 'Paths, identifiers, and code',
      sample: 'const semantic = true;',
      tokens: ['--text-code-size', '--text-code-line-height', '--text-code-weight'],
    },
  ] as const;
  const scales = [
    {
      id: 'typography',
      title: 'Typography',
      tokens: ['--font-ui', '--font-code'],
    },
    {
      id: 'spacing',
      title: 'Spacing',
      tokens: [
        '--space-1',
        '--space-2',
        '--space-3',
        '--space-4',
        '--space-5',
        '--space-6',
        '--space-7',
      ],
    },
    {
      id: 'measures',
      title: 'Content measures',
      tokens: ['--content-measure-reading', '--content-measure-form', '--content-measure-wide'],
    },
    {
      id: 'controls',
      title: 'Control heights',
      tokens: ['--control-height-small', '--control-height-medium', '--control-height-large'],
    },
    {
      id: 'radii',
      title: 'Radii',
      tokens: ['--radius-small', '--radius-medium', '--radius-large'],
    },
    {
      id: 'surface',
      title: 'Surface texture',
      tokens: ['--surface-hatch'],
    },
    {
      id: 'elevation',
      title: 'Elevation',
      tokens: ['--elevation-raised', '--elevation-overlay'],
    },
    {
      id: 'motion',
      title: 'Motion',
      tokens: [
        '--motion-fast',
        '--motion-standard',
        '--motion-slow',
        '--ease-standard',
        '--ease-emphasized-out',
      ],
    },
    {
      id: 'layers',
      title: 'Layers',
      tokens: [
        '--layer-base',
        '--layer-sticky',
        '--layer-chrome',
        '--layer-popover',
        '--layer-modal',
        '--layer-toast',
        '--layer-tooltip',
      ],
    },
  ] as const;
  const tokenNames = [
    ...colorRoles.map(([name]) => name),
    ...scales.flatMap(({ tokens }) => tokens),
    ...typographyStyles.flatMap(({ tokens }) => tokens),
  ];
  let resolved = $state<Record<string, string>>({});

  onMount(() => {
    const root = document.documentElement;
    const update = () => {
      const styles = getComputedStyle(root);
      resolved = Object.fromEntries(
        tokenNames.map((name) => [name, styles.getPropertyValue(name).trim() || 'Not defined']),
      );
    };
    const observer = new MutationObserver(update);
    update();
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => observer.disconnect();
  });
</script>

<section id="foundations" class="scroll-mt-24 space-y-6" aria-labelledby="foundations-title">
  <header class="max-w-3xl space-y-2">
    <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Semantic system</p>
    <h2 id="foundations-title" class="text-2xl font-medium tracking-tight">Foundations</h2>
    <p class="text-sm leading-relaxed text-muted-foreground">
      Live roles resolved from the active theme. These specimens reference the shared CSS variables
      directly, so theme and future token revisions flow through without copied physical values.
    </p>
  </header>

  <div class="foundation-stage rounded-lg border border-border p-3 sm:p-4">
    <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="foundation-colors">
      {#each colorRoles as [name, label] (name)}
        <article
          class="flex min-w-0 items-center gap-3 rounded-md border border-border bg-card p-3"
        >
          <span
            class="size-9 shrink-0 rounded-md border border-border"
            style={`background: hsl(var(${name}))`}
          ></span>
          <div class="min-w-0">
            <h3 class="text-sm font-medium">{label}</h3>
            <code class="block truncate text-xs text-muted-foreground">{name}</code>
            <output class="block truncate text-xs text-muted-foreground">{resolved[name]}</output>
          </div>
        </article>
      {/each}
    </div>
  </div>

  <div class="grid gap-3 lg:grid-cols-2">
    {#each scales as scale (scale.id)}
      <article
        class="rounded-lg border border-border bg-card p-4 {scale.id === 'typography'
          ? 'lg:col-span-2'
          : ''}"
        data-testid={`foundation-${scale.id}`}
      >
        <h3 class="text-sm font-medium">{scale.title}</h3>
        {#if scale.id === 'typography'}
          <p class="type-body mt-1 text-muted-foreground">
            Five supported styles. Use medium weight for emphasis instead of introducing another
            size.
          </p>
          <div
            class="mt-4 divide-y divide-border border-y border-border"
            data-testid="typography-specimens"
          >
            {#each typographyStyles as style (style.id)}
              <section
                class="grid min-w-0 gap-2 py-4 md:grid-cols-[minmax(0,1fr)_15rem] md:gap-6"
                data-typography-style={style.id}
                aria-label={`${style.name} text style`}
              >
                <div class="min-w-0">
                  <div class="type-caption mb-1 text-muted-foreground">{style.name}</div>
                  <div class={style.className}>{style.sample}</div>
                </div>
                <div class="min-w-0 md:text-right">
                  <p class="type-caption text-muted-foreground">{style.use}</p>
                  <code class="type-code text-muted-foreground">.{style.className}</code>
                  <output class="type-caption block text-muted-foreground">
                    {resolved[style.tokens[0]]} / {resolved[style.tokens[1]]} / {resolved[
                      style.tokens[2]
                    ]}
                  </output>
                </div>
              </section>
            {/each}
          </div>
        {:else if scale.id === 'elevation'}
          <div class="mt-3 flex gap-3">
            <span
              class="h-10 flex-1 rounded-md border border-border bg-background"
              style="box-shadow: var(--elevation-raised)"
            ></span>
            <span
              class="h-10 flex-1 rounded-md border border-border bg-popover"
              style="box-shadow: var(--elevation-overlay)"
            ></span>
          </div>
        {:else if scale.id === 'surface'}
          <div
            class="mt-3 h-10 rounded-md border border-border bg-background"
            style="background-image: var(--surface-hatch)"
          ></div>
        {/if}
        {#if scale.id !== 'typography'}
          <dl class="mt-3 divide-y divide-border border-t border-border">
            {#each scale.tokens as name (name)}
              <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 py-2 text-xs">
                <dt><code class="break-all">{name}</code></dt>
                <dd class="max-w-44 truncate text-right text-muted-foreground">{resolved[name]}</dd>
              </div>
            {/each}
          </dl>
        {/if}
      </article>
    {/each}
  </div>
</section>

<style>
  .foundation-stage {
    background-color: hsl(var(--background));
    background-image: var(--surface-hatch);
  }
</style>
