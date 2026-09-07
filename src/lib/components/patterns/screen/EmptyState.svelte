<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { CARD_CONTENT_INSET_CLASS } from '$lib/components/ui/card';
  import { cn } from '$lib/utils';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { StateDensity } from '../state-geometry';

  interface Props extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'children'> {
    title?: Snippet;
    description?: Snippet;
    icon?: Snippet;
    actions?: Snippet;
    actionLabel?: string;
    onAction?: () => void;
    children?: Snippet;
    density?: StateDensity;
    emphasis?: 'routine' | 'prominent';
    severity?: 'routine' | 'danger';
    inset?: boolean;
    class?: string;
    contentClass?: string;
  }

  let {
    title,
    description,
    icon,
    actions,
    actionLabel,
    onAction,
    children,
    density = 'default',
    emphasis = 'routine',
    severity = 'routine',
    inset = false,
    class: className,
    contentClass,
    ...restProps
  }: Props = $props();
</script>

<section
  data-slot="empty-state"
  data-density={density}
  data-emphasis={emphasis}
  data-severity={severity}
  data-inset={inset ? 'card' : undefined}
  class={cn(
    'flex items-center justify-center text-center',
    density === 'compact' ? 'min-h-28 py-6' : 'min-h-48 py-10',
    inset ? CARD_CONTENT_INSET_CLASS : density === 'compact' ? 'px-4' : 'px-6',
    className,
  )}
  {...restProps}
>
  <div class={cn('w-full max-w-md', contentClass)}>
    {#if icon}
      <div
        data-slot="empty-state-icon"
        class={cn(
          'mx-auto flex w-fit',
          density === 'compact' ? 'mb-2' : 'mb-3',
          severity === 'danger' ? 'text-danger' : 'text-muted-foreground',
        )}
      >
        {@render icon()}
      </div>
    {/if}
    {#if title}
      <div
        data-slot="empty-state-title"
        class={cn(
          emphasis === 'prominent'
            ? 'type-title font-semibold text-foreground'
            : 'type-body font-normal',
          emphasis === 'routine' &&
            (severity === 'danger' ? 'text-danger' : 'text-muted-foreground'),
        )}
      >
        {@render title()}
      </div>
    {/if}
    {#if description}
      <div
        data-slot="empty-state-description"
        class={cn(
          title ? 'mt-1 type-caption' : 'type-body',
          severity === 'danger' ? 'text-danger' : 'text-muted-foreground',
        )}
      >
        {@render description()}
      </div>
    {/if}
    {#if actions || (actionLabel && onAction)}
      <div
        data-slot="empty-state-actions"
        class={cn('flex justify-center gap-2', density === 'compact' ? 'mt-3' : 'mt-4')}
      >
        {@render actions?.()}
        {#if actionLabel && onAction}
          <Button
            variant="ghost"
            size={density === 'compact' ? 'compact' : 'default'}
            onclick={onAction}>{actionLabel}</Button
          >
        {/if}
      </div>
    {/if}
    {@render children?.()}
  </div>
</section>
