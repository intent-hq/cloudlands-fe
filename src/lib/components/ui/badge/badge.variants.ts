import type { Snippet } from 'svelte';
import type { HTMLAnchorAttributes } from 'svelte/elements';
import { tv, type VariantProps } from 'tailwind-variants';
import type { WithElementRef } from '$lib/utils.js';

export const badgeVariants = tv({
  base: 'type-caption inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-(--radius-medium) px-2 py-0.5 font-normal transition-[background-color,color,box-shadow,filter] duration-spring-fast ease-spring-fast aria-invalid:ring-2 aria-invalid:ring-danger/25 motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:size-3',
  variants: {
    variant: {
      default:
        'bg-primary text-primary-foreground [a&]:hover:brightness-95 [a&]:active:brightness-90',
      secondary: 'bg-secondary text-secondary-foreground [a&]:hover:bg-hover [a&]:active:bg-active',
      destructive:
        'bg-danger-background text-danger [a&]:hover:brightness-95 [a&]:active:brightness-90',
      outline: 'bg-muted text-foreground [a&]:hover:bg-hover [a&]:active:bg-active',
      success:
        'bg-success text-success-foreground [a&]:hover:brightness-95 [a&]:active:brightness-90',
      info: 'bg-info text-info-foreground [a&]:hover:brightness-95 [a&]:active:brightness-90',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

/** @public contract-tested export surface (badge.test.ts scans for this export) */
export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
type BadgeBaseProps = WithElementRef<HTMLAnchorAttributes> & {
  variant?: BadgeVariant;
  dot?: boolean;
  leadingIcon?: Snippet;
};

export type BadgeProps = BadgeBaseProps &
  (
    | { removable: true; removeLabel: string; onRemove: (event: MouseEvent) => void }
    | { removable?: false; removeLabel?: never; onRemove?: never }
  );
