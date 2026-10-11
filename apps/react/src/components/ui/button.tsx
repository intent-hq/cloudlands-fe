// Based on shadcn/ui button; recipes and content slots match button.svelte.
import * as React from 'react';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/utils';
import { useSize } from '@/components/ui/size-context';
import { IntentMarkLoader } from '@/components/ui/indicators';
import { TooltipShortcut } from '@/components/ui/tooltip';
import {
  activeButtonSurfaceVariants,
  buttonSurfaceVariants,
  buttonVariants,
  type ButtonSize,
  type ButtonVariant,
} from './button-variants';
import './button.css';

export {
  buttonVariants,
  buttonEmphasisLadder,
  buttonSizeLadder,
  buttonCompatibilityAliases,
} from './button-variants';
export type { ButtonSize, ButtonVariant } from './button-variants';

export type ButtonProps = Omit<React.ComponentProps<'button'>, 'ref'> &
  Pick<React.ComponentProps<'a'>, 'href' | 'target' | 'rel' | 'download'> & {
    ref?: React.Ref<HTMLButtonElement | HTMLAnchorElement>;
    variant?: ButtonVariant;
    size?: ButtonSize;
    asChild?: boolean;
    loading?: boolean;
    active?: boolean;
    wrapContent?: boolean;
    truncateLabel?: boolean;
    labelClass?: string;
    iconOnly?: boolean;
    leadingIcon?: React.ReactNode;
    trailingIcon?: React.ReactNode;
    tooltip?: string;
    tooltipDisabled?: boolean;
    tooltipShortcut?: string;
    tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
    tooltipAlign?: 'start' | 'center' | 'end';
    tooltipDelayDuration?: number;
  };

export function Button({
  className,
  variant = 'default',
  size,
  ref,
  href,
  type = 'button',
  disabled,
  loading = false,
  active = false,
  wrapContent = true,
  truncateLabel = true,
  labelClass,
  iconOnly = false,
  leadingIcon,
  trailingIcon,
  onClick,
  children,
  asChild = false,
  tooltip,
  tooltipDisabled = false,
  tooltipShortcut,
  tooltipSide = 'top',
  tooltipAlign = 'center',
  tooltipDelayDuration = 200,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  title,
  ...props
}: ButtonProps) {
  const density = useSize();
  const resolvedSize = size ?? (density === 'compact' ? 'compact' : 'default');
  const resolvedVariant = variant ?? 'default';
  if (
    (iconOnly || resolvedSize.startsWith('icon')) &&
    !ariaLabel?.trim() &&
    !ariaLabelledby?.trim() &&
    !title?.trim() &&
    !tooltip?.trim()
  ) {
    throw new Error(
      'Icon-only Button requires a non-empty aria-label, aria-labelledby, title, or tooltip.',
    );
  }
  const isDisabled = Boolean(disabled || loading);
  const markSize = ['xs', 'compact', 'sm', 'icon-compact', 'icon-xs', 'icon-sm'].includes(
    resolvedSize,
  )
    ? 12
    : ['lg', 'xl', 'icon-lg'].includes(resolvedSize)
      ? 18
      : 16;
  const internals = (content: React.ReactNode) => (
    <>
      <span
        data-slot="button-surface"
        aria-hidden="true"
        style={{ borderRadius: 'inherit' }}
        className={cn(
          'pointer-events-none absolute inset-0 -z-10 transition-[box-shadow,background-color,filter] duration-spring-fast ease-spring-fast motion-reduce:transition-none',
          (active ? activeButtonSurfaceVariants : buttonSurfaceVariants)[resolvedVariant],
        )}
      />
      {wrapContent ? (
        <span
          data-slot="button-content"
          className={cn(
            'relative inline-flex min-w-0 max-w-full flex-1 items-center [&_svg]:transition-[stroke-width] [&_svg]:duration-spring-fast motion-reduce:[&_svg]:transition-none',
            loading && 'opacity-0',
          )}
          style={{ gap: 'inherit', justifyContent: 'inherit' }}
        >
          {leadingIcon && (
            <span
              data-slot="button-leading-icon"
              className="inline-flex shrink-0 items-center justify-center"
            >
              {leadingIcon}
            </span>
          )}
          <span
            data-slot="button-label"
            className={cn('min-w-0 max-w-full flex-1', truncateLabel && 'truncate', labelClass)}
          >
            {content}
          </span>
          {trailingIcon && (
            <span
              data-slot="button-trailing-icon"
              className="inline-flex shrink-0 items-center justify-center"
            >
              {trailingIcon}
            </span>
          )}
        </span>
      ) : (
        content
      )}
      {loading && (
        <span
          data-slot="button-spinner"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          aria-hidden="true"
        >
          <IntentMarkLoader
            size={markSize}
            playing={loading}
            className={markSize === 12 ? 'size-3!' : markSize === 18 ? 'size-[18px]!' : 'size-4!'}
          />
        </span>
      )}
    </>
  );
  const common = {
    'data-slot': 'button',
    'data-state': active ? 'active' : undefined,
    'aria-label': ariaLabel?.trim() ? ariaLabel : tooltip?.trim() ? tooltip : undefined,
    'aria-labelledby': ariaLabelledby,
    'aria-busy': loading || undefined,
    title,
    ...props,
    className: cn(
      buttonVariants({
        variant: resolvedVariant,
        size: resolvedSize,
        leadingIcon: Boolean(leadingIcon),
        trailingIcon: Boolean(trailingIcon),
      }),
      !wrapContent &&
        ['xs', 'sm', 'compact'].includes(resolvedSize) &&
        'has-[>svg]:pl-2 has-[>svg]:pr-2.5',
      className,
    ),
  };
  const handleClick = (event: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => {
    if (isDisabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event as React.MouseEvent<HTMLButtonElement>);
  };
  let element: React.ReactElement;
  if (asChild) {
    const child = React.Children.only(children) as React.ReactElement<{
      children?: React.ReactNode;
    }>;
    element = (
      <Slot.Root
        {...common}
        ref={ref as React.Ref<HTMLElement>}
        aria-disabled={isDisabled || undefined}
        tabIndex={isDisabled ? -1 : common.tabIndex}
        onClick={handleClick}
      >
        {React.cloneElement(child, { children: internals(child.props.children) })}
      </Slot.Root>
    );
  } else if (href) {
    const anchorProps = common as Omit<React.ComponentProps<'a'>, 'ref'>;
    element = (
      <a
        {...anchorProps}
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
        aria-disabled={isDisabled || undefined}
        role={isDisabled ? 'link' : undefined}
        tabIndex={isDisabled ? -1 : props.tabIndex}
        onClick={handleClick}
      >
        {internals(children)}
      </a>
    );
  } else {
    element = (
      <button
        {...common}
        ref={ref as React.Ref<HTMLButtonElement>}
        type={type}
        disabled={isDisabled}
        onClick={handleClick}
      >
        {internals(children)}
      </button>
    );
  }
  return tooltip ? (
    <TooltipShortcut
      label={tooltip}
      shortcut={tooltipShortcut}
      side={tooltipSide}
      align={tooltipAlign}
      delayDuration={tooltipDelayDuration}
      disabled={tooltipDisabled}
    >
      {element}
    </TooltipShortcut>
  ) : (
    element
  );
}
