<script lang="ts">
  import { getContext } from 'svelte';
  import { Select as SelectPrimitive } from 'bits-ui';
  import Fa from 'svelte-fa';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { cn } from '$lib/utils';
  import { Button } from '$lib/components/ui/button';

  type Props = Omit<SelectPrimitive.TriggerProps, 'class'> & {
    variant?: 'default' | 'underline' | 'ghost' | 'secondary';
    class?: string;
  };

  let {
    variant = 'default',
    class: className = '',
    children,
    child,
    onclick,
    ...restProps
  }: Props = $props();

  const select = getContext<{
    invalid: boolean;
    open: boolean;
    triggerId: string;
    listboxId: string;
  }>('canonical-select');
  const variantClasses = {
    default:
      'border border-border bg-transparent shadow-none hover:border-input hover:bg-hover px-3',
    underline:
      'border-0 bg-transparent underline underline-offset-3 decoration-muted-foreground/30 px-3',
    ghost: 'border-0 bg-transparent shadow-none hover:border-transparent hover:bg-hover px-3',
    secondary:
      'border border-border bg-secondary text-secondary-foreground shadow-(--elevation-raised) hover:border-input hover:bg-hover px-3',
  };

  const buttonVariant = $derived(
    variant === 'default' ? 'outline' : variant === 'secondary' ? 'secondary' : 'ghost',
  );
  const triggerClass = $derived(
    cn(
      'group type-caption text-foreground flex h-(--control-height-medium) w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-(--radius-medium) transition-[border-color,background-color,box-shadow] duration-spring-fast aria-invalid:border-danger aria-invalid:ring-1 aria-invalid:ring-danger/25 disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-transparent motion-reduce:transition-none',
      variantClasses[variant],
      className,
    ),
  );

  function handleClick(event: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement }) {
    if (event.detail === 0 && !select.open) select.open = true;
    onclick?.(event);
  }

  function withoutActiveDescendant(props: Record<string, unknown>) {
    const { 'aria-activedescendant': _activeDescendant, ...sanitizedProps } = props;
    return sanitizedProps;
  }
</script>

<SelectPrimitive.Trigger
  {...restProps}
  id={select.triggerId}
  aria-controls={select.open ? select.listboxId : undefined}
  class={triggerClass}
  aria-invalid={select.invalid || undefined}
  onclick={handleClick}
  child={sanitizedTrigger}
></SelectPrimitive.Trigger>

<!-- i18n-ignore (snippet parameter type annotation, not UI text) -->
{#snippet sanitizedTrigger({ props }: { props: Record<string, unknown> })}
  {@const sanitizedProps = withoutActiveDescendant(props)}
  {#if child}
    {@render child({ props: sanitizedProps })}
  {:else}
    <Button {...sanitizedProps} variant={buttonVariant} active={select.open} class={triggerClass}>
      {@render children?.()}
      {#if variant === 'default'}
        <Fa
          icon={faChevronDown}
          class="size-3 shrink-0 text-muted-foreground transition-transform duration-spring-fast group-data-[state=open]:rotate-180 motion-reduce:transition-none"
        />
      {/if}
    </Button>
  {/if}
{/snippet}
