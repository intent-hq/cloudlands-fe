// Source: src/lib/components/ui/list/ListSection.svelte.
import { useMemo, useRef, type ComponentProps, type ReactNode } from 'react';
import { CaretDown, type Icon as IconDefinition } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { slide, usePresence, usePresenceTransition } from '@/lib/motion';
import { cn } from '@/lib/utils';

export type ListSectionProps = ComponentProps<'div'> & {
  titleClass?: string;
  contentClass?: string;
  icon?: IconDefinition;
  actionIcon?: IconDefinition;
  actionLabel?: string;
  onAction?: () => void;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  actions?: ReactNode;
  headingLevel?: 2 | 3 | 4 | 5 | 6;
};
const transition = (node: HTMLElement) => slide(node, { tier: 'moderate' });
function SectionContent({
  present,
  onExit,
  className,
  children,
}: {
  present: boolean;
  onExit: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  usePresenceTransition(ref, present, onExit, transition);
  return (
    <div
      ref={ref}
      data-slot="list-section-content"
      inert={!present}
      aria-hidden={!present || undefined}
      className={cn('flex min-w-0 flex-col items-stretch text-left', className)}
    >
      {children}
    </div>
  );
}
export function ListSection({
  className,
  title,
  titleClass,
  contentClass,
  icon: Icon,
  actionIcon: ActionIcon,
  actionLabel,
  onAction,
  collapsible = false,
  collapsed = false,
  onToggleCollapse,
  children,
  actions,
  headingLevel = 3,
  ...props
}: ListSectionProps) {
  const entries = useMemo(() => (collapsed ? [] : ['content']), [collapsed]);
  const presence = usePresence(entries, (key) => key);
  const controls =
    actions ??
    (ActionIcon && onAction && (
      <Button
        variant="ghost-light"
        size="icon-xs"
        className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          onAction();
        }}
        title={actionLabel}
        aria-label={actionLabel}
      >
        <ActionIcon aria-hidden="true" size={15} />
      </Button>
    ));
  const Heading = `h${headingLevel}` as const;
  const heading = <Heading className="type-caption flex-1 text-left font-medium">{title}</Heading>;
  return (
    <div {...props} data-slot="list-section" className={cn('flex min-w-0 flex-col', className)}>
      {title &&
        (collapsible ? (
          <div
            className={cn(
              'group type-caption flex min-h-7 items-center rounded-md border border-transparent text-left font-medium text-muted-foreground transition-colors duration-spring-fast ease-spring-fast hover:bg-hover hover:text-foreground motion-reduce:transition-none',
              titleClass,
            )}
          >
            <Button
              variant="plain"
              type="button"
              className="flex min-h-7 min-w-0 flex-1 cursor-pointer items-center justify-start gap-1.5 rounded-md border border-transparent px-2 py-1 text-left focus-visible:-outline-offset-1 motion-reduce:transition-none [&_[data-slot=button-content]]:min-w-0 [&_[data-slot=button-content]]:w-full [&_[data-slot=button-content]]:justify-start"
              onClick={() => onToggleCollapse?.()}
              aria-expanded={!collapsed}
            >
              {Icon && <Icon aria-hidden="true" size={12} className="text-muted-foreground/50" />}
              {heading}
              <CaretDown
                aria-hidden="true"
                size={13}
                className={cn(
                  'text-muted-foreground/50 transition-transform duration-spring-moderate ease-spring-moderate motion-reduce:transition-none',
                  collapsed && '-rotate-90',
                )}
              />
            </Button>
            <div className="flex shrink-0 items-center gap-1 pr-1">{controls}</div>
          </div>
        ) : (
          <div
            className={cn(
              'group mb-1 flex min-h-7 items-center justify-between gap-2 px-2 py-1 type-caption font-medium text-muted-foreground',
              titleClass,
            )}
          >
            {heading}
            <div className="flex items-center gap-1">{controls}</div>
          </div>
        ))}
      {presence.entries.map(({ key, present }) => (
        <SectionContent
          key={key}
          present={present}
          onExit={() => presence.remove(key)}
          className={contentClass}
        >
          {children}
        </SectionContent>
      ))}
    </div>
  );
}
