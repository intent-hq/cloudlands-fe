<script lang="ts">
  import { TooltipShortcut } from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils.js';
  import { buttonVariants, type ButtonProps } from './button.variants';

  let {
    class: className,
    variant = 'default',
    size = 'default',
    ref = $bindable(null),
    href = undefined,
    type = 'button',
    disabled,
    loading = false,
    iconOnly = false,
    onclick,
    children,
    tooltip = undefined,
    tooltipDisabled = false,
    tooltipShortcut = undefined,
    tooltipSide = 'top',
    tooltipAlign = 'center',
    tooltipDelayDuration = 200,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledby,
    title,
    ...restProps
  }: ButtonProps = $props();

  const baseClass = $derived(cn(buttonVariants({ variant, size }), className));
  const isDisabled = $derived(Boolean(disabled || loading));
  const accessibleLabel = $derived.by(() => {
    const requiresName = iconOnly || (typeof size === 'string' && size.startsWith('icon'));
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
    if (containerRef) {
      const element = containerRef.firstElementChild as
        HTMLButtonElement | HTMLAnchorElement | null;
      ref = element;
    }
  });
</script>

{#snippet content()}
  <div bind:this={containerRef} style="display: contents;">
    {#if href}
      <a
        data-slot="button"
        class={baseClass}
        {href}
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
        {#if loading}
          <span
            data-slot="button-spinner"
            class="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
            aria-hidden="true"
          ></span>
        {/if}
        {@render children?.()}
      </a>
    {:else}
      <button
        data-slot="button"
        class={baseClass}
        {type}
        disabled={isDisabled}
        aria-label={accessibleLabel}
        aria-labelledby={ariaLabelledby}
        {title}
        aria-busy={loading || undefined}
        onclick={isDisabled ? (event: MouseEvent) => event.preventDefault() : onclick}
        {...restProps}
      >
        {#if loading}
          <span
            data-slot="button-spinner"
            class="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
            aria-hidden="true"
          ></span>
        {/if}
        {@render children?.()}
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
    disabled={tooltipDisabled}
  >
    {@render content()}
  </TooltipShortcut>
{:else}
  {@render content()}
{/if}
