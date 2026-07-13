<script lang="ts">
  import { Tooltip as TooltipPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';
  import type { Snippet } from 'svelte';

  interface Props {
    /** Tooltip content - can be a string or a snippet */
    content?: string | Snippet;
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
    sideOffset?: number;
    alignOffset?: number;
    delayDuration?: number;
    disableHoverableContent?: boolean;
    /** When true, clicking the trigger won't close the tooltip */
    disableCloseOnTriggerClick?: boolean;
    disabled?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    class?: string;
    contentClass?: string;
    arrowClass?: string;
    showArrow?: boolean;
    variant?: 'default' | 'secondary' | 'destructive' | 'outline';
    size?: 'sm' | 'default' | 'lg';
    /** Child elements to wrap with the tooltip trigger */
    children?: Snippet;
    /** Alternative trigger element */
    trigger?: Snippet;
  }

  let {
    content = '',
    side = 'top',
    align = 'center',
    sideOffset = 4,
    alignOffset = 0,
    delayDuration = 0,
    disableHoverableContent = true,
    disableCloseOnTriggerClick = false,
    disabled = false,
    open = $bindable(false),
    onOpenChange,
    class: className = '',
    contentClass = '',
    arrowClass = '',
    showArrow = true,
    variant = 'default',
    size = 'default',
    children,
    trigger,
  }: Props = $props();

  // Variant styles
  const variantStyles = {
    default: 'bg-popover text-popover-foreground border border-border',
    secondary: 'bg-secondary text-secondary-foreground border border-border',
    destructive: 'bg-destructive text-destructive-foreground border border-border',
    outline: 'bg-background border border-border text-foreground',
  };

  // Size styles
  const sizeStyles = {
    sm: 'px-2 py-1 text-xs',
    default: 'px-3 py-1.5 text-sm',
    lg: 'px-4 py-2 text-base',
  };

  // Combined content classes - use $derived to react to prop changes
  const contentClasses = $derived(
    cn(
      'z-[200] w-fit max-w-xs text-balance shadow-xs whitespace-pre-wrap',
      'animate-in fade-in-0 zoom-in-95',
      'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
      'data-[side=bottom]:slide-in-from-top-2',
      'data-[side=left]:slide-in-from-right-2',
      'data-[side=right]:slide-in-from-left-2',
      'data-[side=top]:slide-in-from-bottom-2',
      variantStyles[variant],
      sizeStyles[size],
      contentClass,
    ),
  );

  // Handle open change
  function handleOpenChange(isOpen: boolean) {
    open = isOpen;
    onOpenChange?.(isOpen);
  }
</script>

<!-- Wrap in Provider to ensure context is available even when mounted in isolation
     (e.g., TipTap node views mounted via SvelteNodeViewRenderer) -->
<TooltipPrimitive.Provider {delayDuration}>
  <TooltipPrimitive.Root
    bind:open
    onOpenChange={handleOpenChange}
    {delayDuration}
    {disableHoverableContent}
    {disableCloseOnTriggerClick}
  >
    <TooltipPrimitive.Trigger class={cn('inline-flex', className)} {disabled} data-tooltip-trigger>
      {#if trigger}
        {@render trigger?.()}
      {:else if children}
        {@render children?.()}
      {/if}
    </TooltipPrimitive.Trigger>

    {#if content && !disabled}
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          {side}
          {align}
          {sideOffset}
          {alignOffset}
          class={contentClasses}
          data-tooltip-content
          onFocusOutside={() => {}}
        >
          {#if typeof content === 'string'}
            {content}
          {:else if content && typeof content === 'function'}
            {@render content?.()}
          {/if}

          {#if showArrow}
            <div
              class={cn(
                'absolute bg-border',
                // Top/bottom arrows - horizontal positioning based on align
                side === 'top' && 'w-px h-1.5 -bottom-1.5',
                side === 'bottom' && 'w-px h-1.5 -top-1.5',
                (side === 'top' || side === 'bottom') &&
                  align === 'center' &&
                  'left-1/2 -translate-x-1/2',
                (side === 'top' || side === 'bottom') && align === 'start' && 'left-1.5',
                (side === 'top' || side === 'bottom') && align === 'end' && 'right-1.5',
                // Left/right arrows - vertical positioning based on align
                side === 'left' && 'h-px w-1.5 -right-1.5',
                side === 'right' && 'h-px w-1.5 -left-1.5',
                (side === 'left' || side === 'right') &&
                  align === 'center' &&
                  'top-1/2 -translate-y-1/2',
                (side === 'left' || side === 'right') && align === 'start' && 'top-1.5',
                (side === 'left' || side === 'right') && align === 'end' && 'bottom-1.5',
                arrowClass,
              )}
            ></div>
          {/if}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    {/if}
  </TooltipPrimitive.Root>
</TooltipPrimitive.Provider>
