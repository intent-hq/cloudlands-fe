import type { Snippet } from 'svelte';
import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
import { tv, type VariantProps } from 'tailwind-variants';
import type { WithElementRef } from '$lib/utils.js';

export const buttonVariants = tv({
  base: 'type-body relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent font-medium outline-none transition-[background-color,border-color,color,box-shadow,opacity] duration-[var(--motion-fast)] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/25 motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
  variants: {
    variant: {
      default:
        'border-border bg-card text-foreground shadow-xs hover:border-input hover:bg-secondary hover:text-foreground active:border-input active:bg-muted',
      destructive:
        'border-danger/25 bg-card text-danger shadow-xs hover:border-danger/40 hover:bg-danger hover:text-danger-background focus-visible:ring-danger/35 active:bg-danger/80',
      outline:
        'border-border bg-transparent text-foreground shadow-none hover:border-input hover:bg-secondary hover:text-foreground active:bg-muted',
      secondary:
        'border-border bg-secondary text-secondary-foreground shadow-xs hover:border-input hover:bg-accent hover:text-accent-foreground active:bg-accent/80',
      ghost:
        'bg-transparent text-foreground hover:border-border hover:bg-secondary hover:text-foreground',
      'ghost-light':
        'bg-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground',
      underline:
        'bg-transparent text-muted-foreground underline decoration-border underline-offset-3 hover:text-foreground',
      plain: 'border-transparent shadow-none !px-0 !py-0 font-inherit',
      link: 'border-transparent bg-transparent text-primary underline-offset-4 hover:underline',
      neumorphic:
        'border-border bg-card text-foreground shadow-xs hover:border-input hover:bg-secondary hover:text-foreground active:bg-muted',
    },
    size: {
      default: 'h-8 px-3 has-[>svg]:pl-2.5 has-[>svg]:pr-3',
      xs: 'h-7 px-2 has-[>svg]:pl-2 has-[>svg]:pr-2.5',
      sm: 'h-7 px-2.5 has-[>svg]:pl-2 has-[>svg]:pr-2.5',
      lg: 'h-9 px-4 has-[>svg]:pl-3 has-[>svg]:pr-4',
      xl: 'h-9 px-5 has-[>svg]:pl-4 has-[>svg]:pr-5',
      icon: 'size-8 p-0 [&_svg]:size-4',
      'icon-sm': 'size-7 p-0 [&_svg]:size-4',
      'icon-xs': 'size-7 p-0 [&_svg]:size-3',
      'icon-lg': 'size-9 p-0 [&_svg]:size-4',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

type ButtonBaseProps = WithElementRef<HTMLButtonAttributes> &
  WithElementRef<HTMLAnchorAttributes> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    children?: Snippet;
    onclick?: (event: MouseEvent) => void;
    tooltip?: string;
    tooltipShortcut?: string;
    tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
    tooltipAlign?: 'start' | 'center' | 'end';
    tooltipDelayDuration?: number;
  };

type NamedIconButton =
  | { iconOnly: true; 'aria-label': string }
  | { iconOnly: true; 'aria-labelledby': string }
  | { iconOnly: true; title: string }
  | { iconOnly: true; tooltip: string };

export type ButtonProps = ButtonBaseProps & (NamedIconButton | { iconOnly?: false });
