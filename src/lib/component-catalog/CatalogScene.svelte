<script lang="ts">
  import { tick, type Component } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { loadPreview, setActivePreview } from './preview-discovery';
  import { resolvePreviewState, type PreviewState } from './preview-definition';
  import { waitForCaptureStability } from './capture-stability';

  interface RenderedScene {
    name: string;
    state: PreviewState<Record<string, unknown>>;
  }

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
  let scenes = $state<RenderedScene[]>([]);
  let sceneElement = $state<HTMLElement>();
  let stabilityStatus = $state<'waiting' | 'stable' | 'error'>('waiting');
  let stabilityError = $state('');
  let captureMotion = $state<'full' | 'reduced'>('full');
  const width = $derived(Math.min(1600, Math.max(240, Math.round(requestedWidth))));

  function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

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
    const disposeSetups: Array<() => void> = [];
    let setupDisposed = false;
    const stabilityController = new AbortController();

    const cleanupSetup = (): unknown => {
      if (setupDisposed) return;
      setupDisposed = true;
      let firstError: unknown;
      for (let index = disposeSetups.length - 1; index >= 0; index -= 1) {
        try {
          disposeSetups[index]();
        } catch (cleanupError) {
          firstError ??= cleanupError;
        }
      }
      return firstError;
    };

    const failScene = (stage: 'import' | 'setup' | 'preparation', cause: unknown) => {
      if (cancelled) return;
      const cleanupError = cleanupSetup();
      status = 'error';
      stabilityStatus = 'error';
      Preview = null;
      scenes = [];
      error = `Preview ${stage} failed: ${describeError(cause)}`;
      if (cleanupError) error += ` Cleanup failed: ${describeError(cleanupError)}`;
      setActivePreview(null);
    };

    status = 'loading';
    error = '';
    title = '';
    stateName = '';
    availableStates = [];
    Preview = null;
    scenes = [];
    stabilityStatus = 'waiting';
    stabilityError = '';
    captureMotion = 'full';
    setActivePreview(null);

    void (async () => {
      let loaded;
      try {
        // eslint-disable-next-line intent/no-component-async-data-fetch -- Preview modules are local UI fixtures, not domain data.
        loaded = await loadPreview(nextSlug);
      } catch (loadError) {
        failScene('import', loadError);
        return;
      }
      if (cancelled) return;
      if (!loaded) {
        status = 'error';
        stabilityStatus = 'error';
        stateName = nextState ?? '';
        error = `No executable preview is available for “${nextSlug}”.`;
        return;
      }

      title = loaded.definition.title;
      availableStates = Object.keys(loaded.definition.states);
      const renderedScenes: RenderedScene[] = [];
      if (nextState === 'all') {
        stateName = 'all';
        renderedScenes.push(
          ...Object.entries(loaded.definition.states).map(([name, state]) => ({ name, state })),
        );
      } else {
        const resolved = resolvePreviewState(loaded.definition, nextState);
        if (!resolved.ok) {
          status = 'error';
          stabilityStatus = 'error';
          stateName = resolved.requestedState;
          error = `Unknown state “${resolved.requestedState}”.`;
          return;
        }
        stateName = resolved.name;
        renderedScenes.push({ name: resolved.name, state: resolved.state });
      }
      Preview = loaded.component;
      for (const rendered of renderedScenes) {
        try {
          const dispose = rendered.state.setup?.();
          if (dispose) disposeSetups.push(dispose);
        } catch (setupError) {
          failScene('setup', setupError);
          return;
        }
        scenes = [...scenes, rendered];
        try {
          await tick();
        } catch (preparationError) {
          failScene('preparation', preparationError);
          return;
        }
        if (cancelled) return;
      }

      try {
        if (!sceneElement) throw new Error('Preview scene element is unavailable.');
        const stability = await waitForCaptureStability(sceneElement, {
          signal: stabilityController.signal,
        });
        if (cancelled) return;
        captureMotion = stability.reducedMotion ? 'reduced' : 'full';
        stabilityStatus = 'stable';
        status = 'ready';
        setActivePreview({ slug: nextSlug, state: stateName, width: nextWidth, status: 'ready' });
      } catch (preparationError) {
        if (cancelled || stabilityController.signal.aborted) return;
        const cleanupError = cleanupSetup();
        stabilityStatus = 'error';
        stabilityError = `Preview capture preparation failed: ${describeError(preparationError)}`;
        if (cleanupError) stabilityError += ` Cleanup failed: ${describeError(cleanupError)}`;
      }
    })();

    return () => {
      cancelled = true;
      stabilityController.abort();
      cleanupSetup();
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
  data-preview-stability={stabilityStatus}
  data-preview-stable={stabilityStatus === 'stable' ? 'true' : 'false'}
  data-preview-capture-motion={captureMotion}
  bind:this={sceneElement}
>
  <header class="rounded-lg border border-border bg-card p-4">
    <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Named preview</p>
    <h1 class="mt-1 text-2xl font-medium tracking-tight">{title || slug}</h1>
    {#if availableStates.length > 0}
      <nav class="mt-3 flex flex-wrap gap-2" aria-label="Preview states">
        <a
          class="rounded-md border border-border px-2 py-1 text-xs font-medium text-primary hover:bg-muted"
          aria-current={stateName === 'all' ? 'page' : undefined}
          href={previewUrl('all')}>{m.sandbox_catalogScene_allStates_label()}</a
        >
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
    {#if stabilityStatus === 'error'}
      <div class="rounded-lg border border-destructive bg-card p-4" role="alert">
        <p class="font-medium">{stabilityError}</p>
      </div>
    {/if}
    {#if Preview && scenes.length > 0}
      <div class="grid gap-8" data-preview-scene-list={stateName === 'all' ? 'all' : undefined}>
        {#each scenes as rendered (rendered.name)}
          <article class="grid gap-3" data-preview-rendered-state={rendered.name}>
            {#if stateName === 'all'}
              <h2 class="text-lg font-medium">
                {m.sandbox_catalogScene_stateHeading_title({ state: rendered.name })}
              </h2>
            {/if}
            <div
              class="preview-frame max-w-full overflow-auto rounded-lg border border-border bg-background p-6"
            >
              <div
                class="preview-focus mx-auto max-w-full rounded-md border border-border bg-card p-6"
                style:width={`${width}px`}
                data-testid="catalog-scene-focus"
              >
                <Preview {...rendered.state.props} />
              </div>
            </div>
          </article>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  .catalog-scene {
    width: min(100%, 100rem);
  }
</style>
