import Root from './button.svelte';
import {
  type VariantProps,
  tv,
} from 'tailwind-variants';
import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
import type { WithElementRef } from '$lib/utils.js';

// Re-export the button variants function
export const buttonVariants = tv({
  base: 'focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-all focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 cursor-pointer',
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
      destructive:
        'bg-red-700 text-white shadow-xs hover:bg-red-800 focus-visible:ring-red-700/30 dark:bg-red-600 dark:text-white dark:hover:bg-red-700 dark:focus-visible:ring-red-500/40',
      outline:
        'bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 border',
      secondary: 'bg-background text-secondary-foreground shadow-xs hover:bg-background/80',
      ghost: 'hover:bg-accent/10',
      'ghost-light': 'text-muted-foreground hover:bg-accent/10 dark:hover:bg-accent/20',
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
      xl: 'h-12 rounded-lg px-8 text-base has-[>svg]:px-5',
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

export { Root, Root as Button, type ButtonProps as Props };
