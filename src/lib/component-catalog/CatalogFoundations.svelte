<script lang="ts">
  import { onMount } from 'svelte';

  const colorRoles = [
    ['--background', 'Canvas'],
    ['--foreground', 'Primary text'],
    ['--card', 'Raised surface'],
    ['--popover', 'Overlay surface'],
    ['--primary', 'Primary action'],
    ['--primary-ink', 'Primary text and outline'],
    ['--secondary', 'Secondary action'],
    ['--accent', 'Selection'],
    ['--muted', 'Quiet surface'],
    ['--border', 'Boundary'],
    ['--ring', 'Focus'],
    ['--sidebar', 'Navigation chrome'],
    ['--sidebar-accent', 'Navigation selection'],
  ] as const;
  const interactionRoles = [
    {
      name: '--hover',
      label: 'Hover preview',
      use: 'Previews the pointed or nearest actionable row.',
    },
    {
      name: '--active',
      label: 'Active press',
      use: 'Confirms pointer-down without becoming selection.',
    },
    {
      name: '--selected',
      label: 'Selected',
      use: 'Persists chosen rows, tabs, and options.',
    },
  ] as const;
  const surfaceThemes = [
    {
      id: 'light',
      levels: [
        [1, '--theme-light-surface-1', '--theme-light-shadow-surface-1'],
        [2, '--theme-light-surface-2', '--theme-light-shadow-surface-2'],
        [3, '--theme-light-surface-3', '--theme-light-shadow-surface-3'],
        [4, '--theme-light-surface-4', '--theme-light-shadow-surface-4'],
        [5, '--theme-light-surface-5', '--theme-light-shadow-surface-5'],
        [6, '--theme-light-surface-6', '--theme-light-shadow-surface-6'],
        [7, '--theme-light-surface-7', '--theme-light-shadow-surface-7'],
        [8, '--theme-light-surface-8', '--theme-light-shadow-surface-8'],
      ],
    },
    {
      id: 'dark',
      levels: [
        [1, '--theme-dark-surface-1', '--theme-dark-shadow-surface-1'],
        [2, '--theme-dark-surface-2', '--theme-dark-shadow-surface-2'],
        [3, '--theme-dark-surface-3', '--theme-dark-shadow-surface-3'],
        [4, '--theme-dark-surface-4', '--theme-dark-shadow-surface-4'],
        [5, '--theme-dark-surface-5', '--theme-dark-shadow-surface-5'],
        [6, '--theme-dark-surface-6', '--theme-dark-shadow-surface-6'],
        [7, '--theme-dark-surface-7', '--theme-dark-shadow-surface-7'],
        [8, '--theme-dark-surface-8', '--theme-dark-shadow-surface-8'],
      ],
    },
  ] as const;
  const springTiers = [
    {
      id: 'fast',
      label: 'Fast',
      use: 'Hover, press, focus, icon, and weight feedback',
      duration: '--spring-fast',
      exit: '--spring-fast-exit',
      easing: '--spring-fast-ease',
    },
    {
      id: 'moderate',
      label: 'Moderate',
      use: 'Menus, selection geometry, and compact disclosure',
      duration: '--spring-moderate',
      exit: '--spring-moderate-exit',
      easing: '--spring-moderate-ease',
    },
    {
      id: 'slow',
      label: 'Slow',
      use: 'Large panels and deliberate takeover transitions',
      duration: '--spring-slow',
      exit: '--spring-slow-exit',
      easing: '--spring-slow-ease',
    },
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
      tokens: ['--content-measure-form', '--content-measure-wide'],
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
      id: 'elevation',
      title: 'Elevation',
      tokens: ['--elevation-raised', '--elevation-overlay'],
    },
    {
      id: 'layers',
      title: 'Layers',
      tokens: ['--layer-chrome', '--layer-popover', '--layer-modal', '--layer-tooltip'],
    },
  ] as const;
  const tokenNames = [
    ...colorRoles.map(([name]) => name),
    ...interactionRoles.map(({ name }) => name),
    ...springTiers.flatMap(({ duration, exit, easing }) => [duration, exit, easing]),
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

  <div class="rounded-lg border border-border bg-background p-3 sm:p-4">
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

  <article class="rounded-lg border border-border bg-card p-4" data-testid="foundation-surfaces">
    <h3 class="text-sm font-medium">Surfaces</h3>
    <p class="type-caption mt-1 text-muted-foreground">
      Eight shared background and shadow pairs carry elevation consistently in both themes.
    </p>
    <div class="mt-4 grid gap-4">
      {#each surfaceThemes as theme (theme.id)}
        <section aria-label={`${theme.id} surface ladder`}>
          <h4 class="type-caption mb-2 capitalize text-muted-foreground">{theme.id}</h4>
          <div class="grid grid-cols-4 gap-3 sm:grid-cols-8">
            {#each theme.levels as [level, background, shadow] (level)}
              <div class="grid min-w-0 gap-2">
                <span
                  class="aspect-square rounded-md"
                  data-foundation-surface={`${theme.id}-${level}`}
                  style={`background: hsl(var(${background})); box-shadow: var(${shadow})`}
                ></span>
                <code class="type-code text-center text-muted-foreground">{level}</code>
              </div>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  </article>

  <div class="grid gap-3 lg:grid-cols-2">
    <article
      class="rounded-lg border border-border bg-card p-4"
      data-testid="foundation-interactions"
    >
      <h3 class="text-sm font-medium">Interaction tokens</h3>
      <p class="type-caption mt-1 text-muted-foreground">
        One semantic overlay ladder keeps preview, press, and persistent selection distinct.
      </p>
      <div class="mt-3 grid gap-2">
        {#each interactionRoles as token (token.name)}
          <div class="rounded-md border border-border p-3" style={`background: var(${token.name})`}>
            <div class="flex items-baseline justify-between gap-3">
              <strong class="type-body">{token.label}</strong>
              <output class="type-caption text-muted-foreground">{resolved[token.name]}</output>
            </div>
            <code class="type-code text-muted-foreground">{token.name}</code>
            <p class="type-caption mt-1 text-muted-foreground">{token.use}</p>
          </div>
        {/each}
      </div>
    </article>

    <article class="rounded-lg border border-border bg-card p-4" data-testid="foundation-springs">
      <h3 class="text-sm font-medium">Spring tiers</h3>
      <p class="type-caption mt-1 text-muted-foreground">
        Enters settle with a shared spring curve; exits use the paired crisp tween.
      </p>
      <div class="mt-3 divide-y divide-border border-y border-border">
        {#each springTiers as tier (tier.id)}
          <section class="grid gap-2 py-3" aria-label={`${tier.label} spring tier`}>
            <div class="flex items-baseline justify-between gap-3">
              <strong class="type-body">{tier.label}</strong>
              <span class="type-caption text-muted-foreground">
                {resolved[tier.duration]} in · {resolved[tier.exit]} out
              </span>
            </div>
            <div class="grid min-w-0 gap-1">
              <code class="type-code break-all text-muted-foreground">
                {tier.duration} · {tier.exit}
              </code>
              <div class="flex min-w-0 items-baseline justify-between gap-3">
                <code class="type-code break-all text-muted-foreground">{tier.easing}</code>
                <output class="type-caption max-w-44 truncate text-right text-muted-foreground">
                  {resolved[tier.easing]}
                </output>
              </div>
            </div>
            <p class="type-caption text-muted-foreground">{tier.use}</p>
          </section>
        {/each}
      </div>
    </article>
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
        {:else if scale.id === 'spacing'}
          <dl class="mt-3 grid gap-2" data-testid="spacing-specimens">
            {#each scale.tokens as name (name)}
              <div class="grid min-w-0 grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-3">
                <dt><code class="type-code break-all">{name}</code></dt>
                <dd class="min-w-0">
                  <span
                    class="block h-2 rounded-full bg-primary"
                    data-foundation-spacing={name}
                    style={`width: var(${name})`}
                  ></span>
                </dd>
                <dd class="type-caption text-right text-muted-foreground">{resolved[name]}</dd>
              </div>
            {/each}
          </dl>
        {:else if scale.id === 'controls'}
          <dl class="mt-3 grid gap-2" data-testid="control-height-specimens">
            {#each scale.tokens as name (name)}
              <div class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <dt
                  class="flex items-center rounded-(--radius-small) border border-border bg-background px-3"
                  data-foundation-control={name}
                  style={`height: var(${name})`}
                >
                  <code class="type-code break-all">{name}</code>
                </dt>
                <dd class="type-caption text-right text-muted-foreground">{resolved[name]}</dd>
              </div>
            {/each}
          </dl>
        {:else if scale.id === 'radii'}
          <dl class="mt-3 flex flex-wrap gap-4" data-testid="radius-specimens">
            {#each scale.tokens as name (name)}
              <div class="grid justify-items-center gap-2">
                <dd
                  class="size-12 border border-border bg-muted"
                  data-foundation-radius={name}
                  style={`border-radius: var(${name})`}
                ></dd>
                <dt><code class="type-code break-all">{name}</code></dt>
                <dd class="type-caption text-muted-foreground">{resolved[name]}</dd>
              </div>
            {/each}
          </dl>
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
        {/if}
        {#if scale.id !== 'typography' && scale.id !== 'spacing' && scale.id !== 'controls' && scale.id !== 'radii'}
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
