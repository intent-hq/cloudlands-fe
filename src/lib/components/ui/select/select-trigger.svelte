<script lang="ts">
  import { getContext } from 'svelte';
  import { Select as SelectPrimitive } from 'bits-ui';
  import Fa from 'svelte-fa';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { cn } from '$lib/utils';

  type Props = Omit<SelectPrimitive.TriggerProps, 'class'> & {
    variant?: 'default' | 'underline' | 'ghost' | 'secondary';
    class?: string;
  };

  let {
    variant = 'default',
    class: className = '',
    children,
    onclick,
    ...restProps
  }: Props = $props();

  const select = getContext<{ invalid: boolean; open: boolean }>('canonical-select');
  const variantClasses = {
    default:
      'border border-border bg-card shadow-(--elevation-raised) hover:border-input hover:bg-secondary px-3',
    underline:
      'border-0 bg-transparent underline underline-offset-3 decoration-muted-foreground/30 px-3',
    ghost:
      'border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 hover:border-transparent hover:bg-muted/40 px-3',
    secondary:
      'border border-border bg-secondary text-secondary-foreground shadow-(--elevation-raised) hover:border-input hover:bg-accent px-3',
  };

  function handleClick(event: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement }) {
    if (event.detail === 0 && !select.open) select.open = true;
    onclick?.(event);
  }
</script>

<SelectPrimitive.Trigger
  {...restProps}
  class={cn(
    'group type-body text-foreground flex h-(--control-height-medium) w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-(--radius-medium) outline-none transition-[border-color,background-color,box-shadow] duration-(--motion-fast) focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-danger aria-invalid:ring-1 aria-invalid:ring-danger/25 disabled:cursor-not-allowed disabled:bg-muted/40 disabled:opacity-60 disabled:hover:border-border motion-reduce:transition-none',
    variantClasses[variant],
    className,
  )}
  aria-invalid={select.invalid || undefined}
  onclick={handleClick}
>
  {@render children?.()}
  {#if variant === 'default'}
    <Fa
      icon={faChevronDown}
      class="size-3 shrink-0 text-muted-foreground transition-transform duration-(--motion-fast) group-data-[state=open]:rotate-180 motion-reduce:transition-none"
    />
  {/if}
</SelectPrimitive.Trigger>
