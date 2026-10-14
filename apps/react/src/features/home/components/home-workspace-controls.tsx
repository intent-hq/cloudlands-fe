import type { ReactNode } from 'react';
import type { HomeFilter } from '../../../../../../src/features/home/home-model';
import { Button } from '@/components/ui/button';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { faList, faTableColumns } from '$lib/icons/phosphor-icon-definitions';
import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';
import { HomeSearch } from './home-search';
import { HomeFilterSelect } from './home-filter-select';
import { HomeViewOptions } from './home-view-options';

interface HomeWorkspaceControlsProps {
  query: string;
  filter: HomeFilter;
  view: 'list' | 'board';
  filters: { id: HomeFilter; label: string; count: number }[];
  onquery: (query: string) => void;
  onfilter: (filter: HomeFilter) => void;
  onview: (view: 'list' | 'board') => void;
  settings: ReactNode;
  children?: ReactNode;
}

export function HomeWorkspaceControls({
  query,
  filter,
  view,
  filters,
  onquery,
  onfilter,
  onview,
  settings,
}: HomeWorkspaceControlsProps) {
  return (
    <>
      <HomeSearch
        value={query}
        onchange={onquery}
        placeholder={m.home_search_workspaces()}
        className="min-w-24 w-48 shrink"
        inputClass="home-control-fill rounded-xl border-transparent"
      />
      <div
        className="home-choice-group home-workspace-filters-wide ml-auto shrink-0"
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source named group of view/filter commands and its block layout; these controls are not a form fieldset.
        role="group"
        aria-label={m.layout_allCard_status_label()}
      >
        {filters.map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            size="sm"
            active={filter === item.id}
            aria-pressed={filter === item.id}
            onClick={() => onfilter(item.id)}
          >
            {item.label}
            <span
              className={`home-filter-count ml-1.5 tabular-nums${filter !== item.id ? ' text-muted-foreground' : ''}`}
            >
              {formatInteger(item.count)}
            </span>
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          active={filter === 'archived'}
          aria-pressed={filter === 'archived'}
          onClick={() => onfilter('archived')}
        >
          {m.home_filter_archived()}
        </Button>
      </div>
      <div className="home-workspace-filters-compact ml-auto min-w-0">
        <HomeFilterSelect
          value={filter}
          label={m.layout_allCard_status_label()}
          options={[
            ...filters.map((item) => ({ value: item.id, label: item.label })),
            { value: 'archived', label: m.home_filter_archived() },
          ]}
          onchange={(value) => onfilter(value as HomeFilter)}
        />
      </div>
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source named group of view/filter commands and its block layout; these controls are not a form fieldset. */}
      <div className="home-choice-group shrink-0" role="group" aria-label={m.home_workspace_view()}>
        <Button
          variant="ghost"
          size="icon-sm"
          active={view === 'list'}
          aria-pressed={view === 'list'}
          aria-label={m.home_list_view()}
          tooltip={m.home_list_view()}
          onClick={() => onview('list')}
        >
          <IconDefinitionIcon icon={faList} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          active={view === 'board'}
          aria-pressed={view === 'board'}
          aria-label={m.home_board_view()}
          tooltip={m.home_board_view()}
          onClick={() => onview('board')}
        >
          <IconDefinitionIcon icon={faTableColumns} />
        </Button>
      </div>
      <HomeViewOptions>{settings}</HomeViewOptions>
    </>
  );
}
