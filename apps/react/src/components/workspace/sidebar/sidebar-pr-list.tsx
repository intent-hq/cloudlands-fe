import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import * as Menu from '@/components/ui/menu';
import { cn } from '@/lib/utils';
import type { WorkspacePRPresentationRow } from '$lib/components/shared/pr-presentation-types';
import { m } from '$shared/paraglide/messages.js';

interface SidebarPrListProps {
  rows: WorkspacePRPresentationRow[];
  onSelect: (pr: WorkspacePRPresentationRow) => void;
  /** Interactive rows require an enclosing public Menu.Content. */
  interactive?: boolean;
  className?: string;
}

const rowClass =
  'grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_minmax(0,auto)_auto] items-center gap-x-2 rounded-md px-2 py-1.5 text-left';

function getPrLabel(pr: WorkspacePRPresentationRow): string {
  const identity = pr.repo
    ? m.workspace_card_prBadge_repoLine_tooltip({ repo: pr.repo, number: pr.number })
    : m.workspace_card_prBadge_label({ number: ` #${pr.number}` });
  return [identity, pr.title, pr.details].filter(Boolean).join('\n');
}

function getPrState(pr: WorkspacePRPresentationRow): string {
  return [pr.repoContext, pr.accessibleStateLabel].filter(Boolean).join(' · ');
}

function RowContent({ pr }: { pr: WorkspacePRPresentationRow }) {
  return (
    <>
      <IconDefinitionIcon
        icon={pr.statusIcon}
        size={16}
        className={cn('shrink-0', pr.foregroundClass)}
      />
      <span className="type-body min-w-0 truncate text-foreground">
        {pr.title || m.workspace_hoverCard_pullRequest_label()}
      </span>
      <span className="type-body min-w-0 truncate text-muted-foreground" data-sidebar-pr-state>
        {getPrState(pr)}
      </span>
      <span className="type-body shrink-0 text-muted-foreground">#{pr.number}</span>
    </>
  );
}

export function SidebarPrList({
  rows,
  onSelect,
  interactive = true,
  className = '',
}: SidebarPrListProps) {
  return (
    <div className={cn('grid w-full gap-1', className)} data-sidebar-pr-list>
      {rows.map((pr) =>
        interactive ? (
          <Menu.Item
            key={pr.identity}
            className={rowClass}
            aria-label={getPrLabel(pr)}
            title={getPrLabel(pr)}
            disabled={!pr.url}
            data-sidebar-pr-link
            data-sidebar-pr-url={pr.url}
            data-pr-identity={pr.identity}
            data-pr-status={pr.status}
            onSelect={() => onSelect(pr)}
          >
            <RowContent pr={pr} />
          </Menu.Item>
        ) : (
          <div
            key={pr.identity}
            className={cn(rowClass, !pr.url && 'cursor-default opacity-50')}
            title={getPrLabel(pr)}
            data-sidebar-pr-link
            data-sidebar-pr-url={pr.url}
            data-pr-identity={pr.identity}
            data-pr-status={pr.status}
          >
            <RowContent pr={pr} />
          </div>
        ),
      )}
    </div>
  );
}
