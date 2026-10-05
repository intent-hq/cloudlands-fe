<script lang="ts">
  import { CARD_ROW_GUTTER_CLASS } from '$lib/components/ui/card';
  import { useSize } from '$lib/components/ui/size-context';
  import { cn } from '$lib/utils';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
    leading?: Snippet;
    title: Snippet;
    description?: Snippet;
    meta?: Snippet;
    trailing?: Snippet;
    inset?: boolean;
    class?: string;
  }

  let {
    leading,
    title,
    description,
    meta,
    trailing,
    inset = false,
    class: className,
    ...restProps
  }: Props = $props();
  const density = useSize();
</script>

<div
  data-slot="list-row"
  data-density={density}
  data-inset={inset ? 'card' : undefined}
  class={cn(
    'flex min-w-0 items-start gap-3',
    inset ? CARD_ROW_GUTTER_CLASS : 'px-3',
    density === 'compact' ? 'min-h-9 py-1.5' : 'min-h-12 py-2.5',
    className,
  )}
  {...restProps}
>
  {#if leading}
    <div data-slot="list-row-leading" class="type-caption first-line-icon">
      {@render leading()}
    </div>
  {/if}
  <div class="min-w-0 flex-1">
    <div class="flex min-w-0 items-baseline gap-2">
      <div data-slot="list-row-title" class="min-w-0 truncate type-caption text-foreground">
        {@render title()}
      </div>
      {#if meta}<div class="shrink-0 type-caption text-muted-foreground">{@render meta()}</div>{/if}
    </div>
    {#if description}
      <div class="mt-0.5 min-w-0 type-caption text-muted-foreground">{@render description()}</div>
    {/if}
  </div>
  {#if trailing}<div data-slot="list-row-trailing" class="type-caption first-line-icon gap-1">
      {@render trailing()}
    </div>{/if}
</div>
