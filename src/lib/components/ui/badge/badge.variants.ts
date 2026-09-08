import type { HTMLAnchorAttributes } from 'svelte/elements';
import { tv, type VariantProps } from 'tailwind-variants';
import type { WithElementRef } from '$lib/utils.js';

export const badgeVariants = tv({
  base: 'inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border px-2 text-xs font-medium transition-[background-color,border-color,color,box-shadow] duration-[var(--motion-fast)] focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/25 motion-reduce:transition-none [&>svg]:pointer-events-none [&>svg]:size-3',
  variants: {
    variant: {
      default: 'border-primary/25 bg-primary/10 text-primary [a&]:hover:bg-primary/15',
      secondary: 'border-border bg-muted/70 text-muted-foreground [a&]:hover:bg-muted',
      destructive:
        'border-danger/25 bg-danger-background/10 text-danger [a&]:hover:bg-danger-background/15 focus-visible:ring-danger/30',
      outline: 'border-border bg-card text-foreground [a&]:hover:bg-accent',
      success:
        'border-success/25 bg-success/10 text-success before:size-1.5 before:rounded-full before:border before:border-success before:bg-success [a&]:hover:bg-success/15',
      info: 'border-info/25 bg-info/10 text-info before:size-1.5 before:rounded-full before:border before:border-info before:bg-info [a&]:hover:bg-info/15',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

/** @public contract-tested export surface (badge.test.ts scans for this export) */
export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
export type BadgeProps = WithElementRef<HTMLAnchorAttributes> & { variant?: BadgeVariant };
