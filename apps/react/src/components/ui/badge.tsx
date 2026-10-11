// Based on shadcn/ui badge; colors, aliases and removal mirror badge.svelte.
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useSize } from '@/components/ui/size-context';
import { createTransition } from '@/lib/motion/presence';
import { crispOut } from '@/lib/motion/transitions';
import {
  badgeColors,
  badgeVariants,
  resolveBadge,
  type BadgeColor,
  type BadgeSize,
  type BadgeVariant,
} from './badge-variants';
export { badgeColors, badgeVariants, resolveBadge } from './badge-variants';
export type { BadgeColor, BadgeSize, BadgeVariant } from './badge-variants';

type BadgeBaseProps = Omit<ComponentProps<'a'>, 'color' | 'ref'> & {
  ref?: Ref<HTMLElement>;
  variant?: BadgeVariant;
  color?: BadgeColor;
  size?: BadgeSize;
  dot?: boolean;
  leadingIcon?: ReactNode;
};
export type BadgeProps = BadgeBaseProps &
  (
    | {
        removable: true;
        removeLabel: string;
        onRemove: (event: MouseEvent<HTMLButtonElement>) => void;
      }
    | { removable?: false; removeLabel?: never; onRemove?: never }
  );
export function Badge({
  ref,
  href,
  className,
  variant = 'solid',
  color,
  size,
  style,
  dot = false,
  leadingIcon,
  removable = false,
  removeLabel,
  onRemove,
  children,
  ...props
}: BadgeProps) {
  const density = useSize();
  const [visible, setVisible] = useState(true);
  const removing = useRef(false);
  const root = useRef<HTMLElement | null>(null);
  const transition = useRef<ReturnType<typeof createTransition> | null>(null);
  useEffect(() => () => transition.current?.destroy(), []);
  const resolved = resolveBadge(variant, color);
  const resolvedSize =
    size === 'sm' ? 'compact' : size === 'md' || size === 'lg' ? 'default' : (size ?? density);
  const colorValue = badgeColors[resolved.color];
  const colorStyle: CSSProperties =
    resolved.variant === 'solid'
      ? {
          backgroundColor:
            resolved.color === 'gray'
              ? 'hsl(var(--accent))'
              : `color-mix(in srgb, ${colorValue} 15%, hsl(var(--background)))`,
        }
      : {};
  function beginRemove(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (removing.current) return;
    removing.current = true;
    const finish = () => {
      transition.current?.destroy();
      transition.current = null;
      setVisible(false);
      onRemove?.(event);
    };
    const node = root.current;
    if (!node) {
      finish();
      return;
    }
    transition.current = createTransition(
      node,
      (element) => crispOut(element, { tier: 'fast' }),
      1,
    );
    transition.current.setPresent(false, finish);
  }
  if (!visible) return null;
  const Comp = href ? 'a' : 'span';
  return (
    <Comp
      ref={(node) => {
        root.current = node;
        if (typeof ref === 'function') return ref(node);
        if (ref) ref.current = node;
      }}
      data-slot="badge"
      data-removable={removable || undefined}
      href={href}
      data-variant={resolved.variant}
      data-color={resolved.color}
      data-size={resolvedSize}
      className={cn(badgeVariants({ variant: resolved.variant, size: resolvedSize }), className)}
      style={{ ...colorStyle, ...style }}
      {...props}
    >
      {(dot || resolved.variant === 'dot') && (
        <span
          data-slot="badge-dot"
          className={cn(
            'shrink-0 rounded-full',
            resolvedSize === 'compact' ? 'size-1.5' : 'size-[7px]',
          )}
          style={{
            backgroundColor:
              resolved.color === 'gray' ? 'hsl(var(--muted-foreground))' : colorValue,
          }}
        />
      )}
      {leadingIcon && (
        <span data-slot="badge-icon" className="inline-flex shrink-0">
          {leadingIcon}
        </span>
      )}
      <span className="[text-box:trim-both_cap_alphabetic]">{children}</span>
      {removable && (
        <Button
          variant="ghost"
          size="icon-compact"
          data-slot="badge-remove"
          aria-label={removeLabel}
          className="-mr-1 inline-flex size-4 items-center justify-center rounded-full bg-transparent text-current transition-colors duration-spring-fast ease-spring-fast hover:bg-hover active:bg-active motion-reduce:transition-none"
          onClick={beginRemove}
        >
          <span aria-hidden="true">×</span>
        </Button>
      )}
    </Comp>
  );
}
