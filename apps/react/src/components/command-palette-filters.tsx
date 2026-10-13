import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { m } from '$shared/paraglide/messages.js';
import type { PaletteFilter } from '../../../../src/store/renderer/slices/command-palette/command-palette-utils';

export interface CommandPaletteFiltersHandle {
  cycle: (direction: 1 | -1) => void;
}

export interface CommandPaletteFiltersProps {
  workspaceId?: string;
  activeFilter: PaletteFilter | null;
  isCollaborator: boolean;
  onFilter: (prefix: string) => void;
  ref?: Ref<CommandPaletteFiltersHandle>;
}

export function CommandPaletteFilters({
  workspaceId,
  activeFilter,
  isCollaborator,
  onFilter,
  ref,
}: CommandPaletteFiltersProps) {
  const filterStrip = useRef<HTMLDivElement>(null);
  const filters = [
    { filter: null, label: m.lib_commandPalette_all_label(), prefix: '' },
    ...(workspaceId
      ? [{ filter: 'agent', label: m.layout_commandPalette_agents_group(), prefix: '@' }]
      : []),
    { filter: 'note', label: m.layout_commandPalette_context_group(), prefix: '#' },
    ...(workspaceId
      ? [{ filter: 'file', label: m.layout_commandPalette_files_group(), prefix: '/' }]
      : []),
    { filter: 'workspace', label: m.lib_commandPalette_workspaces_label(), prefix: '*' },
    { filter: 'message', label: m.layout_commandPalette_messages_group(), prefix: '?' },
    ...(workspaceId
      ? [{ filter: 'change', label: m.layout_commandPalette_changes_group(), prefix: '~' }]
      : []),
    ...(workspaceId && !isCollaborator
      ? [
          { filter: 'terminal', label: m.layout_commandPalette_terminals_group(), prefix: '>' },
          { filter: 'browser', label: m.layout_commandPalette_browser_group(), prefix: '^' },
        ]
      : []),
  ];

  useEffect(() => {
    filterStrip.current
      ?.querySelector<HTMLButtonElement>(`[data-filter="${activeFilter ?? 'all'}"]`)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeFilter]);

  useImperativeHandle(ref, () => ({
    cycle(direction) {
      const current = filters.findIndex((item) => item.filter === activeFilter);
      const next = (current + direction + filters.length) % filters.length;
      onFilter(filters[next].prefix);
    },
  }));

  return (
    <div
      ref={filterStrip}
      className="min-w-0 shrink-0 scroll-px-3 overflow-x-auto overscroll-x-contain px-3 py-2"
    >
      <ButtonGroup aria-label={m.lib_commandPalette_filters_ariaLabel()} className="w-max">
        {filters.map((filter) => (
          <Button
            key={filter.prefix}
            variant="ghost"
            size="sm"
            active={activeFilter === filter.filter}
            aria-pressed={activeFilter === filter.filter}
            data-filter={filter.filter ?? 'all'}
            tabIndex={-1}
            className={activeFilter === filter.filter ? 'text-foreground' : 'text-muted-foreground'}
            onClick={() => onFilter(filter.prefix)}
          >
            {filter.label}
          </Button>
        ))}
      </ButtonGroup>
    </div>
  );
}
