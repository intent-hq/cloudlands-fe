// Source: src/lib/components/ui/list/ListItem.svelte. The action controls are siblings of the row button.
import {
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ComponentProps,
  type ReactNode,
  type MouseEvent,
} from 'react';
import type { Icon as IconDefinition } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { TooltipShortcut } from '@/components/ui/tooltip';
import { IntentMarkLoader } from '@/components/ui/indicators';
import { proximityItem, useProximityHover } from '@/lib/interaction';
import { observeOverflow } from '$lib/actions/observe-overflow';
import { cn } from '@/lib/utils';
import { ListProximityContext } from './list-context';

export interface ListItemProps extends ComponentProps<'button'> {
  selected?: boolean;
  active?: boolean;
  variant?: 'default' | 'ghost' | 'subtle';
  size?: 'sm' | 'md';
  icon?: IconDefinition;
  iconComponent?: ComponentType<Record<string, unknown>>;
  iconProps?: Record<string, unknown>;
  iconClass?: string;
  iconSnippet?: ReactNode;
  subtitle?: string;
  titleClass?: string;
  subtitleClass?: string;
  badge?: string | number;
  badgeClass?: string;
  badgeVariant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  loading?: boolean;
  onRightClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  actions?: {
    icon: IconDefinition;
    label: string;
    tooltip?: string;
    onClick: (event: MouseEvent<HTMLButtonElement>) => void;
    className?: string;
  }[];
  actionsVisible?: 'always' | 'hover';
  actionsClass?: string;
  indent?: number;
  indentSize?: number;
}
export function ListItem({
  className,
  selected = false,
  active = false,
  variant = 'default',
  size = 'md',
  icon: Icon,
  iconComponent: IconComponent,
  iconProps = {},
  iconClass,
  iconSnippet,
  title = '',
  subtitle = '',
  titleClass,
  subtitleClass,
  badge,
  badgeClass,
  badgeVariant = 'default',
  loading = false,
  disabled = false,
  children,
  onFocus,
  onBlur,
  onRightClick,
  onContextMenu,
  actions = [],
  actionsClass,
  actionsVisible = 'hover',
  indent = 0,
  indentSize = 22,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  style,
  ...props
}: ListItemProps) {
  const contentId = `${useId()}-content`;
  const context = useContext(ListProximityContext);
  const [index] = useState(() => context?.claimIndex() ?? -1);
  const root = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const subtitleRef = useRef<HTMLDivElement>(null);
  const [titleOverflow, setTitleOverflow] = useState(false);
  const [subtitleOverflow, setSubtitleOverflow] = useState(false);
  const hover = useProximityHover(context?.interactive ? context.hover : null);
  const proximityActive = hover?.activeIndex === index;
  useLayoutEffect(() => {
    if (!hover || !root.current || disabled) return;
    const registration = proximityItem(root.current, { hover, index });
    return () => registration.destroy();
  }, [hover, index, disabled]);
  const hasTitle = Boolean(title);
  const hasSubtitle = Boolean(subtitle);
  useLayoutEffect(() => {
    const a = titleRef.current && observeOverflow(titleRef.current, setTitleOverflow);
    const b = subtitleRef.current && observeOverflow(subtitleRef.current, setSubtitleOverflow);
    return () => {
      a?.destroy?.();
      b?.destroy?.();
    };
  }, [hasTitle, hasSubtitle]);
  useLayoutEffect(() => {
    const row = root.current;
    return () => {
      if (!row?.contains(row.ownerDocument.activeElement)) return;
      const rows = Array.from(
        row
          .closest('[data-slot="list-container"]')
          ?.querySelectorAll<HTMLElement>('[data-slot="list-item"]:not(:disabled)') ?? [],
      );
      const current = rows.findIndex((button) => row.contains(button));
      const remaining = [...rows.slice(current + 1), ...rows.slice(0, current).reverse()];
      queueMicrotask(() => {
        if (row.isConnected || row.ownerDocument.activeElement !== row.ownerDocument.body) return;
        remaining
          .find((button) => button.isConnected && !button.closest('[hidden],[inert]'))
          ?.focus();
      });
    };
  }, []);
  const padding =
    size === 'sm'
      ? 'min-h-(--control-height-compact) px-2 py-0.5'
      : 'min-h-(--control-height-medium) px-2 py-1.5';
  const inset = { paddingLeft: indent * indentSize + 8, paddingRight: 8 };
  return (
    <div
      ref={root}
      data-slot="list-item-row"
      className="group/list-item relative grid w-full min-w-0 flex-1"
    >
      <Button
        {...props}
        variant="plain"
        data-slot="list-item"
        data-variant={variant}
        data-selected={selected || undefined}
        data-active={active || undefined}
        data-proximity-active={proximityActive || undefined}
        aria-current={active ? 'true' : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby ?? (ariaLabel ? undefined : contentId)}
        title={
          titleOverflow || subtitleOverflow
            ? [title, subtitle].filter(Boolean).join(' — ')
            : undefined
        }
        className={cn(
          'relative col-start-1 row-start-1 flex h-full w-full min-w-0 cursor-pointer items-center justify-start rounded-(--radius-row) border border-transparent bg-transparent text-left font-inherit text-foreground transition-colors duration-spring-fast ease-spring-fast [&_[data-slot=button-content]]:min-w-0 [&_[data-slot=button-content]]:w-full [&_[data-slot=button-content]]:justify-start focus-visible:-outline-offset-1 motion-reduce:transition-none group',
          padding,
          !context?.interactive && 'group-hover/list-item:bg-hover',
          selected && 'bg-selected text-foreground',
          active && 'bg-active text-foreground',
          proximityActive && 'bg-hover text-foreground',
          disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
          className,
        )}
        style={{ ...inset, ...style }}
        disabled={disabled}
        onFocus={(event) => {
          hover?.setActiveIndex(index);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          if (hover?.activeIndex === index) hover.setActiveIndex(null);
          onBlur?.(event);
        }}
        onContextMenu={onRightClick ?? onContextMenu}
      />
      <div
        className={cn(
          'pointer-events-none relative col-start-1 row-start-1 flex w-full min-w-0 items-center gap-2',
          padding,
        )}
        style={inset}
      >
        {loading ? (
          <div className="flex w-3.5 shrink-0 items-center justify-center">
            <IntentMarkLoader size={14} />
          </div>
        ) : iconSnippet ? (
          <div className={cn('shrink-0 flex items-center justify-center', iconClass)}>
            {iconSnippet}
          </div>
        ) : (
          (Icon || IconComponent) && (
            <div className={cn('shrink-0 flex items-center justify-center', iconClass)}>
              {IconComponent ? (
                <IconComponent {...iconProps} />
              ) : (
                Icon && (
                  <Icon
                    aria-hidden="true"
                    size={size === 'sm' ? 12 : 14}
                    className={cn('opacity-60 w-3.5', (selected || active) && 'opacity-90')}
                  />
                )
              )}
            </div>
          )
        )}
        <div id={contentId} className="flex min-w-0 flex-1 items-baseline gap-1 text-left">
          {title && (
            <div
              ref={titleRef}
              className={cn(
                'type-caption max-w-full min-w-0 shrink truncate leading-5',
                titleClass,
              )}
            >
              {title}
            </div>
          )}
          {subtitle && (
            <div
              ref={subtitleRef}
              className={cn(
                'type-caption min-w-0 flex-1 truncate text-muted-foreground',
                subtitleClass,
              )}
            >
              {subtitle}
            </div>
          )}
          {children}
        </div>
        {actions.length > 0 && (
          <div
            className={cn(
              'pointer-events-auto relative z-10 shrink-0 flex items-center gap-1',
              actionsVisible === 'hover' &&
                'opacity-0 group-hover/list-item:opacity-100 group-focus-within/list-item:opacity-100 focus-within:opacity-100',
              'transition-opacity motion-reduce:transition-none',
              actionsClass,
            )}
          >
            {actions.map(({ icon: ActionIcon, ...action }) => (
              <TooltipShortcut
                key={action.label}
                label={action.tooltip ?? action.label}
                delayDuration={0}
              >
                <Button
                  variant="plain"
                  size="icon-compact"
                  iconOnly
                  aria-label={action.tooltip ?? action.label}
                  disabled={disabled}
                  className={cn(
                    'h-auto w-auto cursor-pointer rounded-sm border border-transparent p-1 text-muted-foreground transition-colors duration-spring-fast ease-spring-fast hover:bg-hover hover:text-foreground motion-reduce:transition-none',
                    action.className,
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    action.onClick(event);
                  }}
                >
                  <ActionIcon aria-hidden="true" size={10} />
                </Button>
              </TooltipShortcut>
            ))}
          </div>
        )}
        {badge !== undefined && badge !== null && (
          <div
            className={cn(
              'shrink-0 type-caption rounded-sm px-1.5 py-0.5',
              {
                default: 'bg-muted text-subtle group-hover:bg-muted',
                success: 'bg-success/20 text-success',
                warning: 'bg-warning/20 text-warning-ink',
                error: 'bg-danger-background/10 text-danger',
                info: 'bg-info/20 text-info',
              }[badgeVariant],
              badgeClass,
            )}
          >
            {badge}
          </div>
        )}
      </div>
    </div>
  );
}
