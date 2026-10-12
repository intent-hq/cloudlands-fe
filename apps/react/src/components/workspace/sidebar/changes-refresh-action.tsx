// Source: src/lib/components/workspace/sidebar/ChangesRefreshAction.svelte.
import { ArrowClockwiseIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { m } from '$shared/paraglide/messages.js';

export interface ChangesRefreshActionProps {
  disabled: boolean;
  onClick: () => void;
}

export function ChangesRefreshAction({ disabled, onClick }: ChangesRefreshActionProps) {
  const label = m.workspace_sidebarChanges_refreshGitStatus_tooltip();
  return (
    <Button
      iconOnly
      variant="plain"
      size="icon-compact"
      className="expanded-card-action rounded-md text-foreground hover:bg-muted/50 focus-visible:bg-muted"
      onClick={onClick}
      disabled={disabled}
      aria-busy={disabled}
      aria-label={label}
      tooltip={label}
      tooltipSide="top"
      tooltipDelayDuration={300}
      data-changes-refresh=""
    >
      <ArrowClockwiseIcon size={14} weight="regular" />
    </Button>
  );
}
