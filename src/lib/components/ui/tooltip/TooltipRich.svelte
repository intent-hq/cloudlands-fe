<script lang="ts">
  import { Tooltip as TooltipPrimitive } from 'bits-ui';
  import Fa from 'svelte-fa';
  import { cn } from '$lib/utils.js';
  import {
    faXmark,
    faInfo,
    faCircleExclamation,
    faCircleCheck,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import type { Snippet } from 'svelte';
  import TooltipTriggerWrapper from './tooltip-trigger-wrapper.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    title?: string;
    description?: string;
    /** Additional content to render as a snippet */
    content?: Snippet;
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
    sideOffset?: number;
    alignOffset?: number;
    delayDuration?: number;
    disableHoverableContent?: boolean;
    disableCloseOnTriggerClick?: boolean;
    disabled?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    class?: string;
    contentClass?: string;
    contentContainerClass?: string;
    showArrow?: boolean;
    showClose?: boolean;
    onClose?: () => void;
    variant?: 'default' | 'info' | 'success' | 'warning' | 'error' | 'custom';
    maxWidth?: string;
    interactive?: boolean;
    disableAnimation?: boolean;
    /** Child elements to wrap with the tooltip trigger */
    children?: Snippet;
    /** Alternative trigger element */
    trigger?: Snippet;
    icon?: any;
    /** Footer content snippet */
    footer?: Snippet;
    iconClass?: string;
    footerClass?: string;
    descriptionClass?: string;
    onclick?: (event: MouseEvent) => void;
  }

  let {
    title = '',
    description = '',
    content,
    side = 'top',
    align = 'center',
    sideOffset = 8,
    alignOffset = 0,
    delayDuration = 200,
    disableHoverableContent = false,
    disableCloseOnTriggerClick = false,
    disabled = false,
    open = $bindable(false),
    onOpenChange,
    class: className = '',
    contentClass = '',
    contentContainerClass = '',
    showArrow = true,
    showClose = false,
    onClose,
    variant = 'default',
    maxWidth = '20rem',
    interactive = false,
    disableAnimation = false,
    children,
    trigger,
    icon,
    footer,
    iconClass = '',
    footerClass = '',
    descriptionClass = '',
    onclick,
  }: Props = $props();

  // Variant configurations
  const variantConfig = {
    default: {
      bg: 'bg-popover',
      text: 'text-popover-foreground',
      border: '',
      icon: null,
      iconColor: '',
    },
    info: {
      bg: 'bg-info/10',
      text: 'text-info',
      border: 'border border-info/40',
      icon: faInfo,
      iconColor: 'text-info',
    },
    success: {
      bg: 'bg-success/10',
      text: 'text-success',
      border: 'border border-success/40',
      icon: faCircleCheck,
      iconColor: 'text-success',
    },
    warning: {
      bg: 'bg-warning/10',
      text: 'text-warning',
      border: 'border border-warning/40',
      icon: faTriangleExclamation,
      iconColor: 'text-warning',
    },
    error: {
      bg: 'bg-danger',
      text: 'text-danger-background',
      border: 'border border-danger/40',
      icon: faCircleExclamation,
      iconColor: 'text-danger-background',
    },
    custom: {
      bg: '',
      text: '',
      border: '',
      icon: null,
      iconColor: '',
    },
  };

  // Use $derived to react to prop changes
  const config = $derived(variantConfig[variant]);
  const IconComponent = $derived(icon || config.icon);

  // Combined content classes - use $derived to react to prop changes
  const contentClasses = $derived(
    cn(
      'z-(--layer-tooltip) rounded-md border border-border shadow-(--elevation-overlay)',
      'motion-reduce:animate-none motion-reduce:transition-none',
      !disableAnimation && [
        'animate-in fade-in-0 zoom-in-95',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        'data-[side=bottom]:slide-in-from-top-2',
        'data-[side=left]:slide-in-from-right-2',
        'data-[side=right]:slide-in-from-left-2',
        'data-[side=top]:slide-in-from-bottom-2',
      ],
      config.bg,
      config.text,
      config.border,
      contentClass,
    ),
  );

  // Handle open change
  function handleOpenChange(isOpen: boolean) {
    open = isOpen;
    onOpenChange?.(isOpen);
  }

  function handleClose() {
    open = false;
    onClose?.();
  }
</script>

<!-- Wrap in Provider to ensure context is available even when mounted in isolation
     (e.g., TipTap node views mounted via SvelteNodeViewRenderer) -->
<TooltipPrimitive.Provider delayDuration={interactive ? 0 : delayDuration}>
  <TooltipPrimitive.Root
    bind:open
    onOpenChange={handleOpenChange}
    delayDuration={interactive ? 0 : delayDuration}
    disableHoverableContent={!interactive && disableHoverableContent}
    {disableCloseOnTriggerClick}
  >
    <TooltipPrimitive.Trigger
      class={cn('inline-flex', className)}
      {disabled}
      {onclick}
      data-tooltip-trigger
    >
      {#snippet child({ props })}
        <TooltipTriggerWrapper triggerProps={props}>
          {#if trigger}
            {@render trigger?.()}
          {:else if children}
            {@render children?.()}
          {/if}
        </TooltipTriggerWrapper>
      {/snippet}
    </TooltipPrimitive.Trigger>

    {#if !disabled && (title || description || content)}
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          role="tooltip"
          {side}
          {align}
          {sideOffset}
          {alignOffset}
          class={contentClasses}
          data-tooltip-content
          onFocusOutside={() => {}}
        >
          <div class="relative" style="max-width: {maxWidth};">
            {#if showClose}
              <button
                onclick={handleClose}
                class="absolute -right-1 -top-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                aria-label={m.ui_tooltipRich_close_ariaLabel()}
              >
                <Fa icon={faXmark} size="xs" class="w-3 h-3" />
              </button>
            {/if}

            <div class="px-3 py-2 space-y-1 {contentContainerClass}">
              {#if title || IconComponent}
                <div class="flex items-start gap-2">
                  {#if IconComponent}
                    <Fa
                      icon={IconComponent}
                      size="1x"
                      class={cn('w-4 h-4 mt-0.5 flex-shrink-0', config.iconColor, iconClass)}
                    />
                  {/if}
                  {#if title}
                    <h4 class="type-body font-medium">{title}</h4>
                  {/if}
                </div>
              {/if}

              {#if description}
                <p class={cn('type-body opacity-90', descriptionClass)}>{description}</p>
              {/if}

              {#if content}
                <div class="type-caption">
                  {@render content?.()}
                </div>
              {/if}
            </div>

            {#if footer}
              <div class={cn('px-3 py-2', footerClass)}>
                {@render footer?.()}
              </div>
            {/if}
          </div>

          {#if showArrow}
            <TooltipPrimitive.Arrow>
              {#snippet child({ props })}
                <div
                  class={cn(
                    'z-50 bg-border',
                    // Vertical line for top/bottom tooltips, horizontal for left/right
                    'data-[side=top]:w-px data-[side=top]:h-2',
                    'data-[side=bottom]:w-px data-[side=bottom]:h-2',
                    'data-[side=left]:h-px data-[side=left]:w-2',
                    'data-[side=right]:h-px data-[side=right]:w-2',
                  )}
                  {...props}
                ></div>
              {/snippet}
            </TooltipPrimitive.Arrow>
          {/if}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    {/if}
  </TooltipPrimitive.Root>
</TooltipPrimitive.Provider>
