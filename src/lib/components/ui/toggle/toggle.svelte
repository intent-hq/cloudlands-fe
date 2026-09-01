<script lang="ts">
  import { cn } from '$lib/utils';
  import { Toggle as TogglePrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';

  interface Option {
    value: string;
    label: string;
  }

  interface Props {
    pressed?: boolean;
    disabled?: boolean;
    size?: 'default' | 'sm' | 'lg' | 'xs';
    class?: string;
    onclick?: (e: MouseEvent) => void;
    title?: string;
    ariaLabel?: string;
    ariaDescribedby?: string;
    // New props for toggle group (inline/side-by-side style)
    options?: Option[];
    value?: string;
    onChange?: (value: string | boolean) => void;
    variant?: 'single' | 'group' | 'switch' | 'indicator';
    // For switch variant - labels for on/off states
    onLabel?: string;
    offLabel?: string;
    // Svelte 5 snippet for default slot content
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
    options,
    value,
    onChange,
    variant = 'single',
    onLabel = 'On',
    offLabel = 'Off',
    children,
  }: Props = $props();

  function handleCompatibilityClick(e: MouseEvent) {
    if (!disabled) {
      // Don't mutate pressed directly - let the parent manage state via onclick
      // The parent should update the pressed prop, which will flow back down
      onclick?.(e);
      // Call onChange with the NEW value (opposite of current)
      onChange?.(!pressed);
    }
  }

  function handlePressedChange(nextPressed: boolean) {
    pressed = nextPressed;
    onChange?.(nextPressed);
  }

  function handleOptionClick(optionValue: string) {
    if (!disabled) {
      value = optionValue;
      onChange?.(optionValue);
    }
  }

  const sizeClasses = {
    default: 'h-(--control-height-medium) px-2.5',
    sm: 'h-(--control-height-small) px-2',
    lg: 'h-(--control-height-large) px-3',
    xs: 'h-(--control-height-small) px-2',
  };
</script>

{#if variant === 'indicator'}
  <button
    type="button"
    role="switch"
    aria-checked={pressed}
    aria-label={ariaLabel || (pressed ? onLabel : offLabel)}
    aria-describedby={ariaDescribedby}
    data-state={pressed ? 'on' : 'off'}
    {disabled}
    title={title || (pressed ? onLabel : offLabel)}
    onclick={handleCompatibilityClick}
    class={cn(
      'type-body inline-flex cursor-pointer items-center gap-1.5 rounded-(--radius-medium) border border-border font-medium text-muted-foreground transition-[border-color,color,box-shadow] duration-[var(--motion-fast)] hover:border-input focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
      sizeClasses[size],
      pressed && 'text-accent-foreground',
      className,
    )}
  >
    <span
      class={cn(
        'size-2 rounded-full border transition-[background-color,border-color] duration-[var(--motion-fast)] motion-reduce:transition-none',
        pressed ? 'border-success bg-success' : 'border-muted-foreground/60 bg-transparent',
      )}
    ></span>
    <span>{pressed ? onLabel : offLabel}</span>
  </button>
{:else if variant === 'switch'}
  <button
    type="button"
    role="switch"
    aria-checked={pressed}
    aria-label={ariaLabel || (pressed ? onLabel : offLabel)}
    aria-describedby={ariaDescribedby}
    data-state={pressed ? 'on' : 'off'}
    {disabled}
    title={title || (pressed ? onLabel : offLabel)}
    onclick={handleCompatibilityClick}
    class={cn(
      'type-body inline-flex cursor-pointer items-center gap-1.5 rounded-(--radius-medium) border border-border bg-card font-medium text-muted-foreground transition-[background-color,border-color,color,box-shadow] duration-[var(--motion-fast)] hover:border-input hover:bg-accent focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
      sizeClasses[size],
      pressed && 'border-primary/60 text-accent-foreground',
      className,
    )}
  >
    <span
      class={cn(
        'relative flex h-3.5 w-7 items-center rounded-full transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
        pressed ? 'bg-primary' : 'bg-muted',
      )}
    >
      <span
        class={cn(
          'absolute size-3 rounded-full bg-primary-foreground shadow-xs transition-transform duration-[var(--motion-fast)] motion-reduce:transition-none',
          pressed ? 'translate-x-3.5' : 'translate-x-0.5',
        )}
      ></span>
    </span>
    <span class=" text-ui-sm">{pressed ? onLabel : offLabel}</span>
  </button>
{:else if variant === 'group' && options}
  <div
    role="group"
    aria-label={ariaLabel}
    aria-describedby={ariaDescribedby}
    class="inline-flex items-center gap-px rounded-(--radius-medium) border border-border bg-card p-0.5 shadow-(--elevation-raised)"
  >
    {#each options as option (option.value)}
      <button
        type="button"
        onclick={() => handleOptionClick(option.value)}
        title={option.label}
        aria-pressed={value === option.value}
        {disabled}
        data-state={value === option.value ? 'on' : 'off'}
        class={cn(
          'type-body cursor-pointer whitespace-nowrap rounded-(--radius-small) border border-transparent bg-transparent font-medium text-muted-foreground transition-[background-color,border-color,color,box-shadow] duration-[var(--motion-fast)] hover:border-input hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
          sizeClasses[size],
          value === option.value &&
            'border-primary/60 bg-accent text-accent-foreground shadow-(--elevation-raised)',
        )}
      >
        {option.label}
      </button>
    {/each}
  </div>
{:else}
  <TogglePrimitive.Root
    bind:pressed
    onPressedChange={handlePressedChange}
    aria-label={ariaLabel}
    aria-describedby={ariaDescribedby}
    {disabled}
    {title}
    {onclick}
    class={cn(
      'type-body inline-flex cursor-pointer items-center justify-center rounded-(--radius-medium) border border-border bg-card font-medium text-muted-foreground shadow-(--elevation-raised) transition-[background-color,border-color,color,box-shadow] duration-[var(--motion-fast)] hover:border-input hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:border-primary data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground motion-reduce:transition-none',
      sizeClasses[size],
      className,
    )}
  >
    {@render children?.()}
  </TogglePrimitive.Root>
{/if}
