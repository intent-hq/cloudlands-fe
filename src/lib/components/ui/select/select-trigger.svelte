<script lang="ts">
  import { getContext, untrack } from 'svelte';
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
    id,
    ref = $bindable(null),
    ...restProps
  }: Props = $props();

  const select = getContext<{
    invalid: boolean;
    open: boolean;
    triggerId: string;
    registerTriggerId: (id?: string) => void;
    listboxId: string;
  }>('canonical-select');
  untrack(() => select.registerTriggerId(id));
  $effect(() => select.registerTriggerId(id));

  let hasNativeLabel = $state(false);
  $effect(() => {
    const triggerId = select.triggerId;
    hasNativeLabel = Array.from(document.querySelectorAll('label[for]')).some(
      (label) => (label as HTMLLabelElement).htmlFor === triggerId,
    );
  });
  const needsContentLabel = $derived(
    !restProps['aria-label'] && !restProps['aria-labelledby'] && !hasNativeLabel,
  );
  let contentLabel = $state<string | undefined>();
  $effect(() => {
    const element = ref;
    if (!needsContentLabel || !element) {
      contentLabel = undefined;
      return;
    }
    const update = () => {
      contentLabel = element.textContent?.trim() || undefined;
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(element, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  });
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

  function comboboxProps(props: Record<string, unknown>): Record<string, unknown> {
    const {
      'aria-activedescendant': activeDescendant,
      'aria-label': ariaLabel,
      ...triggerProps
    } = props;
    return {
      ...triggerProps,
      role: 'combobox',
      'aria-label': typeof ariaLabel === 'string' ? ariaLabel : contentLabel,
      'aria-activedescendant':
        select.open && typeof activeDescendant === 'string' ? activeDescendant : undefined,
    };
  }
</script>

<SelectPrimitive.Trigger
  {...restProps}
  bind:ref
  id={select.triggerId}
  aria-controls={select.open ? select.listboxId : undefined}
  class={triggerClass}
  aria-invalid={select.invalid || undefined}
  onclick={handleClick}
  child={comboboxTrigger}
></SelectPrimitive.Trigger>

<!-- i18n-ignore (snippet parameter type annotation, not UI text) -->
{#snippet comboboxTrigger({ props }: { props: Record<string, unknown> })}
  {@const triggerProps = comboboxProps(props)}
  {#if child}
    {@render child({ props: triggerProps })}
  {:else}
    <Button {...triggerProps} variant={buttonVariant} active={select.open} class={triggerClass}>
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
