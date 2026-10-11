// Source: src/lib/components/chat/input/ModelPickerGroupHeader.svelte.
import { ArrowsClockwiseIcon, CaretDownIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import type { DropdownGroup } from '@/components/ui/dropdown';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';

export interface ModelPickerGroupHeaderProps {
  group: DropdownGroup;
  groupIndex: number;
  collapsed: boolean;
  refreshing: boolean;
  onToggle: (key: string) => void;
  onRefresh: (key: string) => void;
}

export function ModelPickerGroupHeader({
  group,
  groupIndex,
  collapsed,
  refreshing,
  onToggle,
  onRefresh,
}: ModelPickerGroupHeaderProps) {
  if (!group.label) return null;

  return (
    <div
      className={cn(
        'group/header type-caption flex cursor-pointer select-none items-center gap-2 px-2 font-medium text-muted-foreground',
        groupIndex > 0 && 'pt-1.5',
      )}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The source header contains a separate refresh button; native buttons cannot nest.
      role="button"
      tabIndex={-1}
      aria-label={m.chat_modelPicker_groupModels_ariaLabel({ group: group.label })}
      aria-expanded={!collapsed}
      onClick={() => onToggle(group.key)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle(group.key);
        }
      }}
    >
      <span>{group.label}</span>
      <span className="ml-auto flex items-center gap-0.5">
        <Button
          variant="ghost-light"
          size="icon-xs"
          className={cn(
            'focus-visible:opacity-100',
            refreshing && 'opacity-50! cursor-not-allowed',
          )}
          onClick={(event) => {
            event.stopPropagation();
            onRefresh(group.key);
          }}
          title={m.chat_modelPicker_refreshGroup_title({ group: group.label })}
          aria-label={m.chat_modelPicker_refreshGroup_title({ group: group.label })}
          disabled={refreshing}
        >
          <ArrowsClockwiseIcon
            weight="regular"
            className="size-3 text-subtle transition-transform duration-spring-slow ease-spring-slow motion-reduce:transition-none"
            aria-hidden="true"
          />
        </Button>
        <CaretDownIcon
          weight="regular"
          className={cn(
            'size-4 shrink-0 text-subtle transition-transform duration-spring-fast ease-spring-fast motion-reduce:transition-none',
            collapsed && 'rotate-90',
          )}
          aria-hidden="true"
        />
      </span>
    </div>
  );
}
