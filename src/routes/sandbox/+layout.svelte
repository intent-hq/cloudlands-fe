<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import { sandboxComponents } from './components';

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();

  const activeSlug = $derived(
    (page.params as { slug?: string }).slug ?? page.url.pathname.split('/').filter(Boolean)[1],
  );
</script>

<svelte:head>
  <title>Component sandbox</title>
</svelte:head>

<div class="min-h-screen bg-app-background text-foreground">
  <div class="mx-auto flex min-h-screen w-full max-w-7xl flex-col lg:flex-row">
    <aside class="border-b border-border bg-sidebar/80 lg:w-80 lg:shrink-0 lg:border-b-0 lg:border-r">
      <div class="space-y-4 p-4 lg:sticky lg:top-0 lg:max-h-screen lg:overflow-y-auto lg:p-6">
        <div>
          <a class="text-lg font-semibold text-foreground" href="/sandbox">Component sandbox</a>
          <p class="mt-1 text-sm text-subtle">Preview and tweak in-progress UI components.</p>
        </div>

        <nav class="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0" aria-label="Sandbox components">
          {#each sandboxComponents as component (component.slug)}
            {@const isActive = activeSlug === component.slug}
            <a
              class="min-w-64 rounded-lg border px-3 py-2.5 transition-colors lg:min-w-0 {isActive
                ? 'border-primary/50 bg-primary/10 text-foreground'
                : 'border-border bg-background/70 text-foreground hover:bg-muted/50'}"
              href={`/sandbox/${component.slug}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <span class="block text-sm font-medium">{component.name}</span>
              <span class="mt-1 block text-xs leading-relaxed text-subtle">{component.description}</span>
            </a>
          {/each}
        </nav>
      </div>
    </aside>

    <main class="min-w-0 flex-1 overflow-auto">
      {@render children?.()}
    </main>
  </div>
</div>
