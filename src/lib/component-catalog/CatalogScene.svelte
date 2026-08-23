<script lang="ts">
  import { tick, type Component } from 'svelte';
  import { loadPreview, setActivePreview } from './preview-discovery';
  import { resolvePreviewState, type PreviewState } from './preview-definition';

  let {
    slug,
    requestedState,
    requestedWidth = 720,
  }: { slug: string; requestedState?: string; requestedWidth?: number } = $props();

  let status = $state<'loading' | 'ready' | 'error'>('loading');
  let error = $state('');
  let title = $state('');
  let stateName = $state('');
  let availableStates = $state<string[]>([]);
  let Preview = $state<Component<Record<string, unknown>> | null>(null);
  let scene = $state<PreviewState<Record<string, unknown>> | null>(null);
  const width = $derived(Math.min(1600, Math.max(240, Math.round(requestedWidth))));
  let disposeSetup: (() => void) | undefined;

  function previewUrl(nextState: string, nextWidth = width): string {
    if (typeof window === 'undefined') return `?state=${nextState}&width=${nextWidth}`;
    const url = new URL(window.location.href);
    url.searchParams.set('state', nextState);
    url.searchParams.set('width', String(nextWidth));
    return `${url.pathname}${url.search}`;
  }

  $effect(() => {
    const nextSlug = slug;
    const nextState = requestedState;
    const nextWidth = width;
    let cancelled = false;

    status = 'loading';
    error = '';
    setActivePreview(null);

    void (async () => {
      const loaded = await loadPreview(nextSlug);
      if (cancelled) return;
      if (!loaded) {
        status = 'error';
        stateName = nextState ?? '';
        error = `No executable preview is available for “${nextSlug}”.`;
        return;
      }

      title = loaded.definition.title;
      availableStates = Object.keys(loaded.definition.states);
      const resolved = resolvePreviewState(loaded.definition, nextState);
      if (!resolved.ok) {
        status = 'error';
        stateName = resolved.requestedState;
        error = `Unknown state “${resolved.requestedState}”.`;
        return;
      }

      stateName = resolved.name;
      disposeSetup = resolved.state.setup?.() || undefined;
      scene = resolved.state;
      Preview = loaded.component;
      await tick();
      if (cancelled) return;
      status = 'ready';
      setActivePreview({ slug: nextSlug, state: stateName, width: nextWidth, status: 'ready' });
    })();

    return () => {
      cancelled = true;
      disposeSetup?.();
      disposeSetup = undefined;
      setActivePreview(null);
    };
  });
</script>

<section
  class="catalog-scene mx-auto grid max-w-full gap-4 p-4 sm:p-6 lg:p-10"
  data-testid="catalog-scene"
  data-preview-slug={slug}
  data-preview-state={stateName}
  data-preview-width={width}
  data-preview-status={status}
  data-preview-ready={status === 'ready' ? 'true' : 'false'}
>
  <header class="rounded-lg border border-border bg-card p-4">
    <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Named preview</p>
    <h1 class="mt-1 text-2xl font-medium tracking-tight">{title || slug}</h1>
    {#if availableStates.length > 0}
      <nav class="mt-3 flex flex-wrap gap-2" aria-label="Preview states">
        {#each availableStates as name (name)}
          <a
            class="rounded-md border border-border px-2 py-1 text-xs font-medium text-primary hover:bg-muted"
            aria-current={name === stateName ? 'page' : undefined}
            href={previewUrl(name)}>{name}</a
          >
        {/each}
      </nav>
      <nav class="mt-2 flex flex-wrap gap-2" aria-label="Preview widths">
        {#each [320, 420, 960] as preset (preset)}
          <a
            class="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            aria-current={preset === width ? 'page' : undefined}
            href={previewUrl(stateName, preset)}>{preset}px</a
          >
        {/each}
      </nav>
    {/if}
  </header>

  {#if status === 'error'}
    <div class="rounded-lg border border-destructive bg-card p-4" role="alert">
      <p class="font-medium">{error}</p>
      {#if availableStates.length > 0}
        <p class="mt-1 text-sm text-muted-foreground">
          Available states: {availableStates.join(', ')}
        </p>
      {/if}
    </div>
  {:else}
    <div
      class="preview-frame max-w-full overflow-auto rounded-lg border border-border bg-background p-6"
    >
      <div
        class="preview-focus mx-auto max-w-full rounded-md border border-border bg-card p-6"
        style:width={`${width}px`}
        data-testid="catalog-scene-focus"
      >
        {#if Preview && scene}
          <Preview {...scene.props} />
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
  .catalog-scene {
    width: min(100%, 100rem);
  }
</style>
