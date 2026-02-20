<script lang="ts">
  import { cn } from '$lib/utils';
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
    pressed = false,
    disabled = false,
    size = 'default',
    class: className,
    onclick,
    title,
    ariaLabel,
    options,
    value,
    onChange,
    variant = 'single',
    onLabel = 'On',
    offLabel = 'Off',
    children,
  }: Props = $props();

  function handleClick(e: MouseEvent) {
    if (!disabled) {
      // Don't mutate pressed directly - let the parent manage state via onclick
      // The parent should update the pressed prop, which will flow back down
      onclick?.(e);
      // Call onChange with the NEW value (opposite of current)
      onChange?.(!pressed);
    }
  }

  function handleOptionClick(optionValue: string) {
    if (!disabled) {
      value = optionValue;
      onChange?.(optionValue);
    }
  }

  const sizeClasses = {
    default: 'h-10 px-3 text-sm',
    sm: 'h-8 px-2.5 text-xs',
    lg: 'h-11 px-4 text-base',
    xs: 'h-6 px-2 text-xs',
  };

  const groupSizeClasses = {
    default: 'px-3 py-1.5 text-sm',
    sm: 'px-2.5 py-1 text-xs',
    lg: 'px-4 py-2 text-base',
    xs: 'px-2 py-0.5 text-xs',
  };

  // Track button refs and dimensions for animated background
  // Use plain object with action function to avoid Svelte 5 bind:this dynamic key issues
  const buttonRefs: Record<string, HTMLElement> = {};
  let selectedIndex = $derived(options?.findIndex((opt) => opt.value === value) ?? 0);
  let selectedButtonWidth = $state(0);
  let selectedButtonOffset = $state(0);

  // Action to capture button refs
  function captureRef(node: HTMLElement, optionValue: string) {
    buttonRefs[optionValue] = node;
    // Trigger initial measurement after mounting
    updateDimensions();
    return {
      destroy() {
        delete buttonRefs[optionValue];
      },
    };
  }

  // Update button dimensions
  function updateDimensions() {
    if (options && value && buttonRefs[value]) {
      const button = buttonRefs[value];
      selectedButtonWidth = button.offsetWidth;

      // Calculate offset by summing widths of all previous buttons
      // Start with the padding (0.25rem = 4px at 16px base)
      let offset = 4;
      for (let i = 0; i < selectedIndex; i++) {
        const prevButton = buttonRefs[options[i].value];
        if (prevButton) {
          offset += prevButton.offsetWidth;
        }
      }
      selectedButtonOffset = offset;
    }
  }

  // Update dimensions when selected value changes
  $effect(() => {
    // Track dependencies
    void value;
    void selectedIndex;
    updateDimensions();
  });
</script>

{#if variant === 'indicator'}
  <!-- Indicator Toggle - glowing square indicator with label (skeuomorphic bevel) -->
  <button
    type="button"
    role="switch"
    aria-checked={pressed}
    aria-label={ariaLabel || (pressed ? onLabel : offLabel)}
    data-state={pressed ? 'on' : 'off'}
    {disabled}
    title={title || (pressed ? onLabel : offLabel)}
    onclick={handleClick}
    class={cn(
      'group inline-flex items-center gap-1.5 rounded-md font-medium transition-all cursor-pointer',
      'bg-background',
      // Beveled border: light top-left, dark bottom-right
      'border-t border-l border-t-white/10 border-l-white/10',
      'border-b border-r border-b-black/5 border-r-black/5',
      // 'hover:bg-muted/80',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
      'disabled:pointer-events-none disabled:opacity-50',
      size === 'xs'
        ? 'px-[6px] pt-[3.5px] pb-[3px] text-xs'
        : size === 'sm'
          ? 'px-2.5 py-1.5 text-xs'
          : 'px-3 py-2 text-sm',
      pressed ? 'text-foreground' : 'text-muted-foreground',
      className,
    )}
  >
    <!-- Glowing square indicator with bevel -->
    <span
      class={cn(
        'relative rounded-xs transition-all duration-300',
        size === 'xs' ? 'w-2.5 h-2.5' : size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4',
        pressed
          ? 'bg-accent shadow-[inset_1px_1px_0_rgba(0,0,0,0.15),inset_-1px_-1px_0_rgba(255,255,255,0.3),0_0_6px_1px_hsl(var(--accent)/0.15)]'
          : 'bg-muted-foreground/15 shadow-[inset_1px_1px_0_rgba(0,0,0,0.05),inset_-1px_-1px_0_rgba(255,255,255,0.15)]',
      )}
    ></span>
    <!-- Label -->
    <span
      class="transition-colors uppercase tracking-wider text-[10px] text-muted-foreground/80 font-semibold"
      >{pressed ? onLabel : offLabel}</span
    >
  </button>
{:else if variant === 'switch'}
  <!-- Switch Toggle - single button with on/off indicator -->
  <button
    type="button"
    role="switch"
    aria-checked={pressed}
    aria-label={ariaLabel || (pressed ? onLabel : offLabel)}
    data-state={pressed ? 'on' : 'off'}
    {disabled}
    title={title || (pressed ? onLabel : offLabel)}
    onclick={handleClick}
    class={cn(
      'group inline-flex items-center gap-1.5 rounded-md font-medium transition-all cursor-pointer',
      'bg-sidebar hover:bg-sidebar/80',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
      'disabled:pointer-events-none disabled:opacity-50',
      size === 'xs'
        ? 'px-2 py-0.5 text-xs'
        : size === 'sm'
          ? 'px-2.5 py-1 text-xs'
          : 'px-3 py-1.5 text-sm',
      pressed ? 'text-foreground' : 'text-muted-foreground',
      className,
    )}
  >
    <!-- Pill indicator -->
    <span
      class={cn(
        'relative flex items-center justify-center rounded-full transition-all duration-200',
        size === 'xs' ? 'w-5 h-2.5' : size === 'sm' ? 'w-6 h-3' : 'w-7 h-3.5',
        pressed ? 'bg-accent' : 'bg-muted-foreground/30',
      )}
    >
      <!-- Sliding dot -->
      <span
        class={cn(
          'absolute rounded-full bg-white shadow-sm transition-all duration-200',
          size === 'xs' ? 'w-2 h-2' : size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3',
          pressed
            ? size === 'xs'
              ? 'translate-x-1'
              : size === 'sm'
                ? 'translate-x-1.5'
                : 'translate-x-1.5'
            : size === 'xs'
              ? '-translate-x-1'
              : size === 'sm'
                ? '-translate-x-1.5'
                : '-translate-x-1.5',
        )}
      ></span>
    </span>
    <!-- Label -->
    <span class="transition-colors">{pressed ? onLabel : offLabel}</span>
  </button>
{:else if variant === 'group' && options}
  <!-- Toggle Group (e.g., inline/side-by-side) -->
  <div class="relative inline-flex items-center rounded-md bg-sidebar p-1 gap-0">
    <!-- Animated background indicator -->
    <div
      class="absolute top-1 bottom-1 rounded-sm bg-accent transition-all duration-200 ease-out pointer-events-none"
      style={`left: ${selectedButtonOffset}px; width: ${selectedButtonWidth}px;`}
    ></div>

    <!-- Option buttons -->
    {#each options as option (option.value)}
      <button
        use:captureRef={option.value}
        onclick={() => handleOptionClick(option.value)}
        title={option.label}
        class={`relative z-10 font-medium rounded-sm transition-colors whitespace-nowrap cursor-pointer ${groupSizeClasses[size]} ${
          value === option.value ? 'text-white' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {option.label}
      </button>
    {/each}
  </div>
{:else}
  <!-- Single Toggle Button -->
  <button
    type="button"
    role="switch"
    aria-checked={pressed}
    aria-label={ariaLabel}
    data-state={pressed ? 'on' : 'off'}
    {disabled}
    {title}
    onclick={handleClick}
    class={cn(
      'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
      sizeClasses[size],
      className,
    )}
  >
    {@render children?.()}
  </button>
{/if}
