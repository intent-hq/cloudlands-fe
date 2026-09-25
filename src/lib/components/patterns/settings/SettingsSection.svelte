<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';

  let {
    id,
    title,
    description,
    busy = false,
    error,
    actions,
    children,
    class: className,
  }: {
    id?: string;
    title: string;
    description?: string;
    busy?: boolean;
    error?: string;
    actions?: Snippet;
    children?: Snippet;
    class?: string;
  } = $props();
  const titleId = $derived(id ? `${id}-title` : undefined);
  const descriptionId = $derived(id && description ? `${id}-description` : undefined);
  const errorId = $derived(id && error ? `${id}-error` : undefined);
  const describedBy = $derived([descriptionId, errorId].filter(Boolean).join(' ') || undefined);
</script>

<section
  {id}
  data-highlight-id={id}
  data-slot="settings-section"
  class={cn('min-w-0 scroll-mt-20', className)}
  aria-labelledby={titleId}
  aria-label={titleId ? undefined : title}
  aria-describedby={describedBy}
  aria-busy={busy || undefined}
>
  <header class="space-y-1">
    <div class="flex min-w-0 flex-wrap items-center justify-between gap-3 sm:flex-nowrap">
      <h2 id={titleId} class="type-title min-w-0 break-words text-foreground">{title}</h2>
      {#if actions}<div class="max-w-full shrink-0">{@render actions()}</div>{/if}
    </div>
    {#if description}<p id={descriptionId} class="type-body max-w-2xl text-muted-foreground">
        {description}
      </p>{/if}
  </header>
  {#if error}<p id={errorId} class="type-body mt-2 text-danger" role="alert">
      {error}
    </p>{/if}
  <div
    data-slot="settings-section-content"
    class="mt-4 min-w-0 divide-y divide-border rounded-(--radius-medium) bg-card"
  >
    {@render children?.()}
  </div>
</section>
