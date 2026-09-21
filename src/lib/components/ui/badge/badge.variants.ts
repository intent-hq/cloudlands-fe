import type { Snippet } from 'svelte';
import type { HTMLAnchorAttributes } from 'svelte/elements';
import { tv } from 'tailwind-variants';
import type { WithElementRef } from '$lib/utils.js';

/** Reference badge palette, shared by the component and catalog. */
export const badgeColors = {
  gray: 'hsl(var(--accent))',
  red: 'var(--color-red-500)',
  orange: 'var(--color-orange-500)',
  amber: 'var(--color-amber-500)',
  yellow: 'var(--color-yellow-500)',
  lime: 'var(--color-lime-500)',
  green: 'var(--color-green-500)',
  emerald: 'var(--color-emerald-500)',
  teal: 'var(--color-teal-500)',
  cyan: 'var(--color-cyan-500)',
  blue: 'var(--color-blue-500)',
  indigo: 'var(--color-indigo-500)',
  violet: 'var(--color-violet-500)',
  purple: 'var(--color-purple-500)',
  fuchsia: 'var(--color-fuchsia-500)',
  pink: 'var(--color-pink-500)',
  rose: 'var(--color-rose-500)',
} as const;
export type BadgeColor = keyof typeof badgeColors;
/** @deprecated Use solid or dot with an explicit color. */
type LegacyBadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'info';
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
