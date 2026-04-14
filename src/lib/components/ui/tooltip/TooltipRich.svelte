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
      bg: 'bg-blue-50 dark:bg-blue-950/20',
      text: 'text-blue-900 dark:text-blue-100',
      border: 'border border-blue-200 dark:border-blue-800',
      icon: faInfo,
      iconColor: 'text-blue-500',
    },
    success: {
      bg: 'bg-green-50 dark:bg-green-950/20',
      text: 'text-green-900 dark:text-green-100',
      border: 'border border-green-200 dark:border-green-800',
      icon: faCircleCheck,
      iconColor: 'text-green-500',
    },
    warning: {
      bg: 'bg-yellow-50 dark:bg-yellow-950/20',
      text: 'text-yellow-900 dark:text-yellow-100',
      border: 'border border-yellow-200 dark:border-yellow-800',
      icon: faTriangleExclamation,
      iconColor: 'text-yellow-500',
    },
    error: {
      bg: 'bg-red-50 dark:bg-red-950/20',
      text: 'text-red-900 dark:text-red-100',
      border: 'border border-red-200 dark:border-red-800',
      icon: faCircleExclamation,
      iconColor: 'text-red-500',
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
      'z-[200] shadow-lg border border-border',
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
  >
    <TooltipPrimitive.Trigger class={cn('inline-flex', className)} {disabled} data-tooltip-trigger>
      {#if trigger}
        {@render trigger?.()}
      {:else if children}
        {@render children?.()}
      {/if}
    </TooltipPrimitive.Trigger>

    {#if !disabled && (title || description || content)}
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
          <div class="relative" style="max-width: {maxWidth};">
            {#if showClose}
              <button
                onclick={handleClose}
                class="absolute -top-1 -right-1 p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                aria-label="Close tooltip"
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
                    <h4 class="font-semibold text-sm leading-tight">{title}</h4>
                  {/if}
                </div>
              {/if}

              {#if description}
                <p class={cn('text-sm leading-snug opacity-90', descriptionClass)}>{description}</p>
              {/if}

              {#if content}
                <div class="text-xs">
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
