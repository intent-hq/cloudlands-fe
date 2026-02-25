<script lang="ts" module>
  import { cn, type WithElementRef } from '$lib/utils.js';
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
  import { type VariantProps, tv } from 'tailwind-variants';

  export const buttonVariants = tv({
    base: 'focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 cursor-pointer',
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive:
          'bg-destructive-foreground shadow-xs hover:bg-destructive-foreground/90 focus-visible:ring-destructive-foreground/20 dark:focus-visible:ring-destructive-foreground/40 dark:bg-destructive-foreground/60 text-destructive',
        outline:
          'bg-card text-foreground shadow-xs hover:bg-muted/50 border border-border hover:border-border/80',
        secondary: 'bg-background text-secondary-foreground shadow-xs hover:bg-background/80',
        ghost: 'text-foreground/70 hover:bg-muted/50 hover:text-foreground',
        'ghost-light': 'text-muted-foreground hover:text-foreground/80 hover:bg-muted/30',
        underline:
          'text-muted-foreground underline underline-offset-3 decoration-muted-foreground/20',
        plain: 'shadow-none !px-0 !py-0 font-inherit',
        link: 'text-primary underline-offset-4 hover:underline',
        neumorphic:
          'rounded-2xl bg-gradient-to-b from-white to-gray-50 dark:from-gray-800 dark:to-gray-900 text-foreground shadow-[8px_8px_16px_rgba(0,0,0,0.08),-8px_-8px_16px_rgba(255,255,255,0.5)] dark:shadow-[8px_8px_16px_rgba(0,0,0,0.4),-8px_-8px_16px_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.06),inset_-2px_-2px_4px_rgba(255,255,255,0.5)] dark:hover:shadow-[inset_2px_2px_4px_rgba(0,0,0,0.4),inset_-2px_-2px_4px_rgba(255,255,255,0.05)] active:shadow-[inset_4px_4px_8px_rgba(0,0,0,0.1),inset_-4px_-4px_8px_rgba(255,255,255,0.5)] dark:active:shadow-[inset_4px_4px_8px_rgba(0,0,0,0.5),inset_-4px_-4px_8px_rgba(255,255,255,0.05)] border border-white/50 dark:border-border/30 transition-all duration-200',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        xs: 'h-7 gap-1.5 rounded-md text-xs px-2 has-[>svg]:px-2',
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9 [&_svg]:size-4',
        'icon-sm': 'size-8 [&_svg]:size-4',
        'icon-xs': 'size-6 [&_svg]:size-3',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  });

  export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
  export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

  export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
    WithElementRef<HTMLAnchorAttributes> & {
      variant?: ButtonVariant;
      size?: ButtonSize;
    };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { TooltipShortcut } from '$lib/components/ui/tooltip';

  let {
    class: className,
    variant = 'default',
    size = 'default',
    ref = $bindable(null),
    href = undefined,
    type = 'button',
    disabled,
    onclick,
    children,
    tooltip = undefined,
    tooltipShortcut = undefined,
    tooltipSide = 'top',
    tooltipAlign = 'center',
    tooltipDelayDuration = 200,
    ...restProps
  }: ButtonProps & {
    children?: Snippet;
    onclick?: (e: MouseEvent) => void;
    tooltip?: string;
    /** Keyboard shortcut to display in tooltip (e.g., 'mod+s', 'esc') */
    tooltipShortcut?: string;
    tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
    tooltipAlign?: 'start' | 'center' | 'end';
    tooltipDelayDuration?: number;
  } = $props();

  const baseClass = $derived(cn(buttonVariants({ variant, size }), className));
  let containerRef: HTMLDivElement | null = $state(null);

  $effect(() => {
    if (containerRef) {
      const element = containerRef.firstElementChild as
        | HTMLButtonElement
        | HTMLAnchorElement
        | null;
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
        aria-disabled={disabled}
        role={disabled ? 'link' : undefined}
        tabindex={disabled ? -1 : undefined}
        onclick={disabled ? (e: MouseEvent) => e.preventDefault() : onclick}
        {...restProps}
      >
        {@render children?.()}
      </a>
    {:else}
      <button data-slot="button" class={baseClass} {type} {disabled} {onclick} {...restProps}>
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
  >
    {@render content()}
  </TooltipShortcut>
{:else}
  {@render content()}
{/if}
