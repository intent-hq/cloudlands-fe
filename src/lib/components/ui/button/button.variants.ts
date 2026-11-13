import type { Snippet } from 'svelte';
import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
import { tv, type VariantProps } from 'tailwind-variants';
import type { WithElementRef } from '$lib/utils.js';

export const buttonEmphasisLadder = [
  { value: 'primary', label: 'Primary', guidance: 'One highest-priority action per region.' }, // i18n-ignore (design-system catalog metadata)
  { value: 'secondary', label: 'Secondary', guidance: 'Supporting actions that remain visible.' }, // i18n-ignore (design-system catalog metadata)
  { value: 'ghost', label: 'Ghost', guidance: 'Low-emphasis or repeated toolbar actions.' }, // i18n-ignore (design-system catalog metadata)
  {
    value: 'destructive',
    label: 'Destructive',
    guidance: 'Irreversible or damaging actions only.', // i18n-ignore (design-system catalog metadata)
  },
] as const;

export const buttonSizeLadder = [
  { value: 'sm', iconValue: 'icon-sm', label: 'Small' },
  { value: 'default', iconValue: 'icon', label: 'Medium' },
  { value: 'lg', iconValue: 'icon-lg', label: 'Large' },
] as const;

export const buttonCompatibilityAliases = [
  { prop: 'variant', alias: 'default', replacement: 'secondary' },
  { prop: 'variant', alias: 'tertiary', replacement: 'outline' },
  { prop: 'variant', alias: 'neumorphic', replacement: 'outline' },
  { prop: 'size', alias: 'xs', replacement: 'compact' },
  { prop: 'size', alias: 'icon-xs', replacement: 'icon-compact' },
] as const;

const outlineButtonClasses = 'border border-border text-foreground hover:bg-hover active:bg-active';

// Bordered controls paint their state on the root so native clipping follows every corner.
export const buttonVariants = tv({
  base: 'type-caption group/button relative isolate inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-(--radius-medium) border-0 bg-transparent font-normal transition-[color,opacity,background-color] duration-spring-fast ease-spring-fast disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-invalid:ring-1 aria-invalid:ring-danger motion-reduce:transition-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
  variants: {
    variant: {
      primary: 'text-primary-foreground',
      default: 'text-secondary-foreground',
      destructive: 'bg-danger text-danger-background',
      outline: outlineButtonClasses,
      tertiary: outlineButtonClasses,
      secondary: 'text-secondary-foreground',
      ghost: 'text-foreground',
      'ghost-light': 'text-muted-foreground hover:text-foreground',
      underline:
        'text-muted-foreground underline decoration-border underline-offset-3 hover:text-foreground',
      plain: 'text-inherit font-inherit',
      link: 'text-primary-ink underline-offset-4 hover:underline',
      neumorphic: outlineButtonClasses,
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
  // Apply after size padding, while still allowing caller utilities to override it.
  compoundVariants: [{ variant: 'plain', class: 'px-0 py-0' }],
  defaultVariants: {
    variant: 'secondary',
    size: 'default',
  },
});

export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

type ConcreteButtonVariant = Exclude<ButtonVariant, null | undefined>;

const activeOutlineButtonClasses = 'bg-active hover:bg-active active:bg-active';

export const activeButtonRootVariants: Partial<Record<ConcreteButtonVariant, string>> = {
  outline: activeOutlineButtonClasses,
  tertiary: activeOutlineButtonClasses,
  neumorphic: activeOutlineButtonClasses,
};

export const buttonSurfaceVariants: Record<ConcreteButtonVariant, string> = {
  primary:
    'bg-primary shadow-(--elevation-raised) group-hover/button:brightness-95 group-active/button:brightness-90 group-active/button:shadow-none',
  default:
    'bg-secondary shadow-(--elevation-raised) group-hover/button:brightness-95 group-active/button:brightness-90 group-active/button:shadow-none',
  secondary:
    'bg-secondary shadow-(--elevation-raised) group-hover/button:brightness-95 group-active/button:brightness-90 group-active/button:shadow-none',
  destructive:
    'bg-danger shadow-(--elevation-raised) group-hover/button:brightness-95 group-active/button:brightness-90 group-active/button:shadow-none',
  outline: 'bg-transparent shadow-none',
  tertiary: 'bg-transparent shadow-none',
  neumorphic: 'bg-transparent shadow-none',
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
  default: 'bg-secondary brightness-90 shadow-none',
  secondary: 'bg-secondary brightness-90 shadow-none',
  destructive: 'bg-danger brightness-90 shadow-none',
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
    /** Bypass content wrappers only when direct children define full-card flex/grid geometry. */
    wrapContent?: boolean;
    truncateLabel?: boolean;
    labelClass?: string;
    leadingIcon?: Snippet;
    trailingIcon?: Snippet;
    children?: Snippet;
    onclick?: (event: MouseEvent) => void;
    tooltip?: string;
    tooltipDisabled?: boolean;
    tooltipShortcut?: string;
    tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
    tooltipAlign?: 'start' | 'center' | 'end';
    tooltipDelayDuration?: number;
    /** Called when the tooltip opens or closes. */
    tooltipOnOpenChange?: (open: boolean) => void;
    /** Classes for the tooltip's trigger wrapper (e.g. `min-w-0` so the button can shrink). */
    tooltipClass?: string;
    /** Optional appearance for the floating content; trigger geometry is unchanged. */
    tooltipContentClass?: string;
  };

type NamedIconButton =
  | { iconOnly: true; 'aria-label': string }
  | { iconOnly: true; 'aria-labelledby': string }
  | { iconOnly: true; title: string }
  | { iconOnly: true; tooltip: string };

export type ButtonProps = ButtonBaseProps & (NamedIconButton | { iconOnly?: false });
