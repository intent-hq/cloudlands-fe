// Source: src/lib/components/workspace/sidebar/SidebarGroupHeader.svelte.
import { CaretDownIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface SidebarGroupHeaderProps {
  title: string;
  meta?: string;
  expanded: boolean;
  onClick: () => void;
  collapsedChevronClass?: string;
}

export function SidebarGroupHeader({
  title,
  meta,
  expanded,
  onClick,
  collapsedChevronClass = '-rotate-90',
}: SidebarGroupHeaderProps) {
  return (
    <Button
      variant="ghost"
      size="compact"
      className="h-7 w-full justify-start gap-2 rounded-md px-2 text-ui font-semibold text-muted-foreground hover:text-foreground"
      aria-expanded={expanded}
      onClick={onClick}
      data-sidebar-group-header=""
    >
      <span className="min-w-0 flex-1 truncate text-left">{title}</span>
      {meta && (
        <span className="shrink-0 type-caption font-normal tabular-nums text-muted-foreground">
          {meta}
        </span>
      )}
      <CaretDownIcon
        size="1em"
        weight="regular"
        mirrored={false}
        aria-hidden="true"
        data-icon="chevron-down"
        data-weight="regular"
        className={cn(
          'size-3 shrink-0 opacity-50 transition-transform duration-spring-moderate ease-spring-moderate motion-reduce:transition-none',
          !expanded && collapsedChevronClass,
        )}
      />
    </Button>
  );
}
