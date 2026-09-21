<script lang="ts">
  import { cn } from '$lib/utils';
  import { Toggle as TogglePrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';

  interface Props extends Omit<TogglePrimitive.RootProps, 'children' | 'child'> {
    pressed?: boolean;
    disabled?: boolean;
    size?: 'default' | 'sm' | 'lg' | 'xs';
    class?: string;
    onclick?: (e: MouseEvent) => void;
    title?: string;
    ariaLabel?: string;
    ariaDescribedby?: string;
    onChange?: (pressed: boolean) => void;
    children?: Snippet;
  }

  let {
    ref = $bindable(null),
    pressed = $bindable(false),
    disabled = false,
    size = 'default',
    class: className,
    onclick,
    title,
    ariaLabel,
    ariaDescribedby,
    onChange,
    children,
    ...restProps
  }: Props = $props();

  function handlePressedChange(nextPressed: boolean) {
    pressed = nextPressed;
    onChange?.(nextPressed);
    restProps.onPressedChange?.(nextPressed);
  }

  const sizeClasses = {
    default: 'h-(--control-height-medium) px-2.5',
    sm: 'h-(--control-height-small) px-2',
    lg: 'h-(--control-height-large) px-3',
    xs: 'h-(--control-height-small) px-2',
  };
</script>

<TogglePrimitive.Root
  bind:ref
  bind:pressed
  aria-label={ariaLabel}
  aria-describedby={ariaDescribedby}
  {disabled}
  {title}
  {onclick}
  class={cn(
    'type-caption inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-(--radius-medium) border border-border bg-muted text-muted-foreground transition-[background-color,color,box-shadow] duration-spring-fast ease-spring-fast data-[state=off]:hover:bg-hover data-[state=off]:active:bg-active disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-selected data-[state=on]:shadow-(--elevation-raised) data-[state=on]:text-foreground data-[state=on]:hover:bg-selected motion-reduce:transition-none',
    sizeClasses[size],
    className,
  )}
  {...restProps}
  onPressedChange={handlePressedChange}
>
  {@render children?.()}
</TogglePrimitive.Root>
