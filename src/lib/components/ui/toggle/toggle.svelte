<script lang="ts">
  import { cn } from '$lib/utils';
  import { Toggle as TogglePrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';

  interface Props {
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
  }: Props = $props();

  function handlePressedChange(nextPressed: boolean) {
    pressed = nextPressed;
    onChange?.(nextPressed);
  }

  const sizeClasses = {
    default: 'h-(--control-height-medium) px-2.5',
    sm: 'h-(--control-height-small) px-2',
    lg: 'h-(--control-height-large) px-3',
    xs: 'h-(--control-height-small) px-2',
  };
</script>

<TogglePrimitive.Root
  bind:pressed
  onPressedChange={handlePressedChange}
  aria-label={ariaLabel}
  aria-describedby={ariaDescribedby}
  {disabled}
  {title}
  {onclick}
  class={cn(
    'type-caption inline-flex cursor-pointer items-center justify-center rounded-(--radius-medium) border-0 bg-transparent font-normal text-muted-foreground shadow-(--elevation-raised) transition-[background-color,color,box-shadow,font-weight] duration-spring-fast ease-spring-fast hover:bg-hover active:bg-active disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-selected data-[state=on]:[--text-caption-weight:500] data-[state=on]:text-foreground data-[state=on]:hover:bg-active motion-reduce:transition-none',
    sizeClasses[size],
    className,
  )}
>
  {@render children?.()}
</TogglePrimitive.Root>
