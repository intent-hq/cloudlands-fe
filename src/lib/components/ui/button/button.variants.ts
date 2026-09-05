import type { Snippet } from 'svelte';
import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
import { tv, type VariantProps } from 'tailwind-variants';
import type { WithElementRef } from '$lib/utils.js';

export const buttonVariants = tv({
  base: 'type-caption group/button relative isolate inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-(--radius-medium) border border-transparent bg-transparent font-medium transition-[color,opacity] duration-spring-fast ease-spring-fast disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-invalid:ring-1 aria-invalid:ring-danger motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
  variants: {
    variant: {
      primary: 'text-primary-foreground',
      default: 'text-primary-foreground',
      destructive: 'bg-danger text-danger-background',
      outline: 'text-foreground',
      tertiary: 'text-foreground',
      secondary: 'text-secondary-foreground',
      ghost: 'text-foreground',
      'ghost-light': 'text-muted-foreground hover:text-foreground',
      underline:
        'text-muted-foreground underline decoration-border underline-offset-3 hover:text-foreground',
      plain: 'text-inherit !px-0 !py-0 font-inherit',
      link: 'text-primary-ink underline-offset-4 hover:underline',
      neumorphic: 'text-foreground',
    },
    size: {
      default: 'h-(--control-height-medium) px-4 [--button-icon-padding:0.75rem]',
      compact: 'h-(--control-height-compact) gap-1 px-3 [--button-icon-padding:0.375rem]',
      xs: 'h-(--control-height-compact) gap-1 px-3 [--button-icon-padding:0.375rem]',
      sm: 'h-(--control-height-small) gap-1 px-3 [--button-icon-padding:0.375rem]',
      lg: 'h-(--control-height-large) px-4 [--button-icon-padding:0.75rem]',
      xl: 'h-(--control-height-large) px-5 [--button-icon-padding:1rem]',
      icon: 'size-(--control-height-medium) p-0 [&_svg]:size-4',
      'icon-compact': 'size-(--control-height-compact) p-0 [&_svg]:size-3.5',
      'icon-sm': 'size-(--control-height-small) p-0 [&_svg]:size-4',
      'icon-xs': 'size-(--control-height-compact) p-0 [&_svg]:size-3',
      'icon-lg': 'size-(--control-height-large) p-0 [&_svg]:size-4',
    },
    leadingIcon: { true: 'pl-[var(--button-icon-padding)]' },
    trailingIcon: { true: 'pr-[var(--button-icon-padding)]' },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

type ConcreteButtonVariant = Exclude<ButtonVariant, null | undefined>;

export const buttonSurfaceVariants: Record<ConcreteButtonVariant, string> = {
  primary:
    'bg-primary shadow-(--elevation-raised) group-hover/button:brightness-95 group-active/button:brightness-90 group-active/button:shadow-none',
  default:
    'bg-primary shadow-(--elevation-raised) group-hover/button:brightness-95 group-active/button:brightness-90 group-active/button:shadow-none',
  secondary:
    'bg-secondary shadow-(--elevation-raised) group-hover/button:brightness-95 group-active/button:brightness-90 group-active/button:shadow-none',
  destructive:
    'bg-danger shadow-(--elevation-raised) group-hover/button:brightness-95 group-active/button:brightness-90 group-active/button:shadow-none',
  outline:
    'bg-transparent shadow-[0_0_0_1px_var(--color-border),inset_0_0_0_0_var(--color-border)] group-hover/button:bg-hover group-active/button:bg-active group-active/button:shadow-[0_0_0_0_var(--color-border),inset_0_0_0_1px_var(--color-border)]',
  tertiary:
    'bg-transparent shadow-[0_0_0_1px_var(--color-border),inset_0_0_0_0_var(--color-border)] group-hover/button:bg-hover group-active/button:bg-active group-active/button:shadow-[0_0_0_0_var(--color-border),inset_0_0_0_1px_var(--color-border)]',
  neumorphic:
    'bg-transparent shadow-[0_0_0_1px_var(--color-border),inset_0_0_0_0_var(--color-border)] group-hover/button:bg-hover group-active/button:bg-active group-active/button:shadow-[0_0_0_0_var(--color-border),inset_0_0_0_1px_var(--color-border)]',
  ghost:
    'bg-transparent shadow-[0_0_0_1px_transparent] group-hover/button:bg-hover group-hover/button:shadow-[0_0_0_1px_var(--hover)] group-active/button:bg-active group-active/button:shadow-[0_0_0_0_var(--active)]',
  'ghost-light':
    'bg-transparent shadow-[0_0_0_1px_transparent] group-hover/button:bg-hover group-hover/button:shadow-[0_0_0_1px_var(--hover)] group-active/button:bg-active group-active/button:shadow-[0_0_0_0_var(--active)]',
  underline: 'bg-transparent shadow-[0_0_0_1px_transparent]',
  plain: 'bg-transparent shadow-[0_0_0_1px_transparent]',
  link: 'bg-transparent shadow-[0_0_0_1px_transparent]',
};

export const activeButtonSurfaceVariants: Record<ConcreteButtonVariant, string> = {
  ...buttonSurfaceVariants,
  primary: 'bg-primary brightness-90 shadow-none',
  default: 'bg-primary brightness-90 shadow-none',
  secondary: 'bg-secondary brightness-90 shadow-none',
  destructive: 'bg-danger brightness-90 shadow-none',
  outline:
    'bg-active shadow-[0_0_0_1px_var(--color-border),inset_0_0_0_0_var(--color-border)] group-active/button:shadow-[0_0_0_0_var(--color-border),inset_0_0_0_1px_var(--color-border)]',
  tertiary:
    'bg-active shadow-[0_0_0_1px_var(--color-border),inset_0_0_0_0_var(--color-border)] group-active/button:shadow-[0_0_0_0_var(--color-border),inset_0_0_0_1px_var(--color-border)]',
  neumorphic:
    'bg-active shadow-[0_0_0_1px_var(--color-border),inset_0_0_0_0_var(--color-border)] group-active/button:shadow-[0_0_0_0_var(--color-border),inset_0_0_0_1px_var(--color-border)]',
  ghost:
    'bg-active shadow-[0_0_0_1px_var(--active)] group-active/button:shadow-[0_0_0_0_var(--active)]',
  'ghost-light':
    'bg-active shadow-[0_0_0_1px_var(--active)] group-active/button:shadow-[0_0_0_0_var(--active)]',
};

type ButtonBaseProps = WithElementRef<HTMLButtonAttributes> &
  WithElementRef<HTMLAnchorAttributes> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    active?: boolean;
    truncateLabel?: boolean;
    labelClass?: string;
    leadingIcon?: Snippet;
    trailingIcon?: Snippet;
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
