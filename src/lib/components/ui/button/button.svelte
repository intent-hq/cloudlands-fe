<script lang="ts">
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { TooltipShortcut } from '$lib/components/ui/tooltip';
  import { useSize } from '$lib/components/ui/size-context';
  import { cn } from '$lib/utils.js';
  import {
    activeButtonSurfaceVariants,
    buttonSurfaceVariants,
    buttonVariants,
    type ButtonProps,
  } from './button.variants';

  let {
    class: className,
    variant = 'default',
    size = undefined,
    ref = $bindable(),
    href = undefined,
    type = 'button',
    disabled,
    loading = false,
    active = false,
    wrapContent = true,
    truncateLabel = true,
    labelClass = undefined,
    iconOnly = false,
    leadingIcon,
    trailingIcon,
    onclick,
    children,
    tooltip = undefined,
    tooltipShortcut = undefined,
    tooltipSide = 'top',
    tooltipAlign = 'center',
    tooltipDelayDuration = 200,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledby,
    title,
    ...restProps
  }: ButtonProps = $props();

  const contextSize = useSize();
  const resolvedSize = $derived(size ?? (contextSize === 'compact' ? 'compact' : 'default'));
  const baseClass = $derived(
    cn(
      buttonVariants({
        variant,
        size: resolvedSize,
        leadingIcon: Boolean(leadingIcon),
        trailingIcon: Boolean(trailingIcon),
      }),
      className,
    ),
  );
  const surfaceClass = $derived(
    cn(
      'pointer-events-none absolute inset-px transition-[box-shadow,background-color,filter] duration-spring-fast ease-spring-fast motion-reduce:transition-none',
      (active ? activeButtonSurfaceVariants : buttonSurfaceVariants)[variant],
    ),
  );
  const intentMarkSize = $derived(
    resolvedSize === 'xs' ||
      resolvedSize === 'compact' ||
      resolvedSize === 'sm' ||
      resolvedSize === 'icon-compact' ||
      resolvedSize === 'icon-xs' ||
      resolvedSize === 'icon-sm'
      ? 12
      : resolvedSize === 'lg' || resolvedSize === 'xl' || resolvedSize === 'icon-lg'
        ? 18
        : 16,
  );
  const intentMarkSizeClass = $derived(
    intentMarkSize === 12 ? 'size-3!' : intentMarkSize === 18 ? 'size-[18px]!' : 'size-4!',
  );
  const isDisabled = $derived(Boolean(disabled || loading));
  const accessibleLabel = $derived.by(() => {
    const requiresName = iconOnly || resolvedSize.startsWith('icon');
    if (
      requiresName &&
      !ariaLabel?.trim() &&
      !ariaLabelledby?.trim() &&
      !title?.trim() &&
      !tooltip?.trim()
    ) {
      throw new Error(
        // i18n-ignore (developer-facing invariant error, never rendered in UI)
        'Icon-only Button requires a non-empty aria-label, aria-labelledby, title, or tooltip.',
      );
    }
    return ariaLabel?.trim() ? ariaLabel : tooltip?.trim() ? tooltip : undefined;
  });
  let containerRef: HTMLDivElement | null = $state(null);

  $effect(() => {
    if (!containerRef) return;
    const element = containerRef.firstElementChild as HTMLButtonElement | HTMLAnchorElement | null;
    ref = element;
    return () => {
      if (ref === element) ref = null;
    };
  });
</script>

{#snippet internals()}
  <span
    data-slot="button-surface"
    class={surfaceClass}
    style="border-radius: inherit"
    aria-hidden="true"
  ></span>
  {#if wrapContent}
    <span
      data-slot="button-content"
      class="relative inline-flex min-w-0 max-w-full flex-1 items-center [&_svg]:transition-[stroke-width] [&_svg]:duration-spring-fast motion-reduce:[&_svg]:transition-none"
      style="gap: inherit; justify-content: inherit"
      class:opacity-0={loading}
    >
      {#if leadingIcon}
        <span
          data-slot="button-leading-icon"
          class="inline-flex shrink-0 items-center justify-center"
        >
          {@render leadingIcon()}
        </span>
      {/if}
      <span
        data-slot="button-label"
        class={cn('min-w-0 max-w-full flex-1', truncateLabel && 'truncate', labelClass)}
        >{@render children?.()}</span
      >
      {#if trailingIcon}
        <span
          data-slot="button-trailing-icon"
          class="inline-flex shrink-0 items-center justify-center"
        >
          {@render trailingIcon()}
        </span>
      {/if}
    </span>
  {:else}
    {@render children?.()}
  {/if}
  {#if loading}
    <span
      data-slot="button-spinner"
      class="pointer-events-none absolute inset-0 flex items-center justify-center"
      aria-hidden="true"
    >
      <IntentMarkLoader
        variant="bloom"
        size={intentMarkSize}
        playing={loading}
        class={intentMarkSizeClass}
      />
    </span>
  {/if}
{/snippet}

{#snippet content()}
  <div bind:this={containerRef} style="display: contents;">
    {#if href}
      <a
        data-slot="button"
        class={baseClass}
        {href}
        data-state={active ? 'active' : undefined}
        aria-label={accessibleLabel}
        aria-labelledby={ariaLabelledby}
        {title}
        aria-busy={loading || undefined}
        aria-disabled={isDisabled || undefined}
        role={isDisabled ? 'link' : undefined}
        tabindex={isDisabled ? -1 : undefined}
        onclick={isDisabled ? (event: MouseEvent) => event.preventDefault() : onclick}
        {...restProps}
      >
        {@render internals()}
      </a>
    {:else}
      <button
        data-slot="button"
        class={baseClass}
        {type}
        data-state={active ? 'active' : undefined}
        disabled={isDisabled}
        aria-label={accessibleLabel}
        aria-labelledby={ariaLabelledby}
        {title}
        aria-busy={loading || undefined}
        onclick={isDisabled ? (event: MouseEvent) => event.preventDefault() : onclick}
        {...restProps}
      >
        {@render internals()}
      </button>
    {/if}
  </div>
{/snippet}

{#if tooltip}
  <TooltipShortcut
    label={tooltip}
    shortcut={tooltipShortcut}
    side={tooltipSide}
    align={tooltipAlign}
    delayDuration={tooltipDelayDuration}
  >
    {@render content()}
  </TooltipShortcut>
{:else}
  {@render content()}
{/if}

<style>
  :global([data-slot='button-content'] svg) {
    stroke-width: 1.5;
  }

  :global([data-slot='button-label']:has(> *)) {
    display: inline-flex;
    align-items: center;
    justify-content: inherit;
    gap: inherit;
    text-overflow: clip;
  }

  :global([data-slot='button-label'] > *) {
    min-width: 0;
  }

  :global([data-slot='button-label'] > svg) {
    flex-shrink: 0;
  }

  :global([data-slot='button']:hover [data-slot='button-content'] svg) {
    stroke-width: 2;
  }
</style>
