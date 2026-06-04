<script lang="ts">
  import { sandboxComponents } from './components';
</script>

<section class="mx-auto max-w-4xl space-y-6 p-6 lg:p-10">
  <div class="space-y-3">
    <p class="text-xs font-medium uppercase tracking-wide text-subtle">Developer tools</p>
    <h1 class="text-3xl font-semibold tracking-tight text-foreground">Component sandbox</h1>
    <p class="max-w-2xl text-base leading-relaxed text-subtle">
      Component sandbox — pick a component on the left to preview and tweak its variants.
    </p>
  </div>

  <div class="grid gap-3 sm:grid-cols-2">
    {#each sandboxComponents as component (component.slug)}
      <a
        class="rounded-xl border border-border bg-background p-4 shadow-xs transition-colors hover:bg-muted/40"
        href={`/sandbox/${component.slug}`}
      >
        <h2 class="text-sm font-semibold text-foreground">{component.name}</h2>
        <p class="mt-2 text-sm leading-relaxed text-subtle">{component.description}</p>
      </a>
    {/each}
  </div>
</section>
