<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';
  import { highlightTarget } from '$lib/components/ui/highlight/highlight-target';

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
  use:highlightTarget={{ id }}
  class={cn('min-w-0', className)}
  aria-labelledby={titleId}
  aria-label={titleId ? undefined : title}
  aria-describedby={describedBy}
  aria-busy={busy || undefined}
>
  <header class="flex flex-wrap items-start justify-between gap-3 sm:flex-nowrap">
    <div class="min-w-0 space-y-1">
      <h2 id={titleId} class="type-title break-words text-foreground">
        {title}
      </h2>
      {#if description}
        <p id={descriptionId} class="type-body max-w-2xl text-muted-foreground">
          {description}
        </p>
      {/if}
    </div>
    {#if actions}<div class="max-w-full shrink-0">{@render actions()}</div>{/if}
  </header>
  {#if error}
    <p id={errorId} class="type-body mt-2 text-danger" role="alert">{error}</p>
  {/if}
  <div
    data-slot="settings-section-content"
    class="mt-4 min-w-0 space-y-1 rounded-(--radius-medium) bg-card px-3 sm:px-4"
  >
    {@render children?.()}
  </div>
</section>
