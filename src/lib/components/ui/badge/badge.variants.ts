import type { Snippet } from 'svelte';
import type { HTMLAnchorAttributes } from 'svelte/elements';
import { tv } from 'tailwind-variants';
import type { WithElementRef } from '$lib/utils.js';

/** Reference badge palette, shared by the component and catalog. */
export const badgeColors = {
  gray: '#a3a3a3',
  red: '#ef4444',
  orange: '#f97316',
  amber: '#f59e0b',
  yellow: '#eab308',
  lime: '#84cc16',
  green: '#22c55e',
  emerald: '#10b981',
  teal: '#14b8a6',
  cyan: '#06b6d4',
  blue: '#3b82f6',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  purple: '#a855f7',
  fuchsia: '#d946ef',
  pink: '#ec4899',
  rose: '#f43f5e',
} as const;
export type BadgeColor = keyof typeof badgeColors;
/** @deprecated Use solid or dot with an explicit color. */
export type LegacyBadgeVariant =
  'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'info';
export type BadgeVariant = 'solid' | 'dot' | LegacyBadgeVariant;
export type BadgeSize = 'default' | 'compact' | 'sm' | 'md' | 'lg';

const legacyVariants = {
  default: { variant: 'solid', color: 'gray' },
  secondary: { variant: 'solid', color: 'gray' },
  outline: { variant: 'dot', color: 'gray' },
  destructive: { variant: 'solid', color: 'red' },
  success: { variant: 'solid', color: 'green' },
  info: { variant: 'solid', color: 'blue' },
} as const;

export function resolveBadge(variant: BadgeVariant = 'solid', color?: BadgeColor) {
  const resolved =
    variant === 'solid' || variant === 'dot'
      ? { variant, color: 'gray' as BadgeColor }
      : legacyVariants[variant];
  return { ...resolved, color: color ?? resolved.color };
}

export const badgeVariants = tv({
  base: 'inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap rounded-(--radius-medium) font-medium text-foreground transition-[background-color,color,box-shadow] duration-spring-fast ease-spring-fast motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:size-3',
  variants: {
    variant: { solid: '', dot: 'border border-border' },
    size: { default: 'h-6 px-2.5 text-[12px] gap-1.5', compact: 'h-5 px-2 text-[11px] gap-1' },
  },
  defaultVariants: { variant: 'solid', size: 'default' },
});

type BadgeBaseProps = Omit<WithElementRef<HTMLAnchorAttributes>, 'color'> & {
  variant?: BadgeVariant;
  color?: BadgeColor;
  size?: BadgeSize;
  dot?: boolean;
  leadingIcon?: Snippet;
};

export type BadgeProps = BadgeBaseProps &
  (
    | { removable: true; removeLabel: string; onRemove: (event: MouseEvent) => void }
    | { removable?: false; removeLabel?: never; onRemove?: never }
  );
