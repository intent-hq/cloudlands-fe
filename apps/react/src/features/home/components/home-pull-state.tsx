import {
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import {
  faCodePullRequest,
  faCodeMerge,
  faHourglassHalf,
} from '$lib/icons/phosphor-icon-definitions';
import { m } from '$shared/paraglide/messages.js';

export interface HomePullStateProps {
  state?: string;
  compact?: boolean;
}

export function HomePullState({ state, compact = false }: HomePullStateProps) {
  const appearance =
    state === 'merged'
      ? {
          icon: faCodeMerge,
          color: 'text-primary',
          label: m.ui_linkTooltip_gitHubStateMerged_label(),
        }
      : state === 'closed'
        ? {
            icon: faCodePullRequest,
            color: 'text-danger',
            label: m.ui_linkTooltip_gitHubStateClosed_label(),
          }
        : state === 'draft'
          ? {
              icon: faCodePullRequest,
              color: 'text-muted-foreground',
              label: m.ui_linkTooltip_gitHubStateDraft_label(),
            }
          : state === 'queued'
            ? {
                icon: faHourglassHalf,
                color: 'text-info',
                label: m.ui_linkTooltip_gitHubStateQueued_label(),
              }
            : {
                icon: faCodePullRequest,
                color: 'text-success',
                label: m.ui_linkTooltip_gitHubStateOpen_label(),
              };
  return (
    <TooltipProvider>
      <TooltipRoot>
        <TooltipTrigger asChild tabIndex={0}>
          <span className={`inline-flex items-center gap-1.5 type-caption ${appearance.color}`}>
            <IconDefinitionIcon icon={appearance.icon} />
            <span className={compact ? 'sr-only' : undefined}>{appearance.label}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{appearance.label}</TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}
