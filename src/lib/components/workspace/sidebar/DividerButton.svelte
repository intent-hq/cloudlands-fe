<script lang="ts">
  /**
   * DividerButton - A button styled to sit on a timeline divider
   * Has a background to "cut through" the divider line
   */
  import Fa from 'svelte-fa';
  import {
  faSpinner,
  faArrowDown,
  faArrowRight,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
  import type { Snippet } from 'svelte';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import { Tooltip as TooltipPrimitive } from 'bits-ui';
  import { cn } from '$lib/utils.js';

  interface Props {
    onclick?: () => void;
    disabled?: boolean;
    loading?: boolean;
    expanded?: boolean;
    showArrow?: boolean;
    arrowUp?: boolean;
    arrowRight?: boolean;
    icon?: IconDefinition;
    tooltipContents?: string;
    children?: Snippet;
    [key: string]: unknown;
  }

  let {
    onclick,
    disabled = false,
    loading = false,
    expanded = false,
    showArrow = true,
    arrowUp = false,
    arrowRight = false,
    icon,
    tooltipContents = '',
    children,
    ...restProps
  }: Props = $props();

  const buttonClass = $derived(
    cn(
      'relative z-20 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1.5 py-1.5 px-3 rounded-md border border-border hover:border-border bg-background -mb-px',
      'disabled:bg-sidebar disabled:cursor-default disabled:hover:text-muted-foreground/50 disabled:text-muted-foreground',
    ),
  );
</script>

{#snippet buttonContent()}
  {#if loading}
    <Fa icon={faSpinner} size="xs" class="animate-spin" />
  {:else}
    {#if arrowUp && showArrow}
      <Fa icon={faArrowDown} size="xs" class="text-ghost rotate-180" />
    {/if}
    {#if icon}
      <Fa {icon} size="xs" class="text-ghost" />
    {/if}
    {#if children}
      {@render children()}
    {/if}
    {#if !arrowUp && showArrow}
      {#if expanded}
        <Fa icon={faXmark} size="xs" class="text-ghost" />
      {:else if arrowRight}
        <Fa icon={faArrowRight} size="xs" class="text-ghost" />
      {:else}
        <Fa icon={faArrowDown} size="xs" class="text-ghost" />
      {/if}
    {/if}
  {/if}
{/snippet}

{#if tooltipContents}
  <!-- Provider ensures proper context and cleanup during component destruction -->
  <TooltipPrimitive.Provider delayDuration={200}>
    <TooltipPrimitive.Root delayDuration={200} disableHoverableContent>
      <TooltipPrimitive.Trigger>
        {#snippet child({ props })}
          <button type="button" class={buttonClass} {onclick} {disabled} {...restProps} {...props}>
            {@render buttonContent()}
          </button>
        {/snippet}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="top"
          align="start"
          sideOffset={4}
          class="z-50 w-fit max-w-xs text-balance shadow-xs whitespace-pre-wrap bg-popover text-popover-foreground border border-border px-2 py-1 text-xs animate-in fade-in-0 zoom-in-95"
          onFocusOutside={() => {}}
        >
          {tooltipContents}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  </TooltipPrimitive.Provider>
{:else}
  <button type="button" class={buttonClass} {onclick} {disabled} {...restProps}>
    {@render buttonContent()}
  </button>
{/if}
