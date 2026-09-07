<script lang="ts">
  import type { Snippet } from 'svelte';
  import { notify } from '$lib/components/patterns/notify';
  import { Button } from '$lib/components/ui/button';

  let {
    title,
    description,
    source,
    children,
  }: { title: string; description: string; source: string; children: Snippet } = $props();
  let copied = $state(false);

  async function copySource() {
    try {
      await navigator.clipboard.writeText(source);
      copied = true;
    } catch {
      copied = false;
      notify.error('Could not copy source.');
    }
  }
</script>

<section
  class="overflow-hidden rounded-lg border border-border bg-card shadow-(--elevation-raised)"
>
  <header class="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
    <div class="min-w-0">
      <h2 class="type-title">{title}</h2>
      <p class="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
    <Button variant="outline" size="sm" onclick={copySource}>
      {copied ? 'Copied' : 'Copy source'}
    </Button>
  </header>
  <div class="min-w-0 bg-background p-5">{@render children()}</div>
  <details class="border-t border-border">
    <summary class="cursor-pointer px-5 py-3 text-sm font-medium hover:bg-hover"
      >View source</summary
    >
    <pre class="overflow-x-auto border-t border-border bg-muted p-4 text-xs"><code>{source}</code
      ></pre>
  </details>
</section>
