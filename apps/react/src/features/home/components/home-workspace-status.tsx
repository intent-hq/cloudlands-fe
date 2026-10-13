import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import {
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  faCircleCheck,
  faCircleQuestion,
  faCircleExclamation,
} from '$lib/icons/phosphor-icon-definitions';
import { m } from '$shared/paraglide/messages.js';
import { getHomeStatusCause } from '../../../../../../src/features/home/home-attention';
import {
  getHomeTriageGroup,
  type HomeTriageInput,
} from '../../../../../../src/features/home/home-model';

export interface HomeWorkspaceStatusProps {
  workspace: HomeTriageInput;
  className?: string;
  showLabel?: boolean;
}
export function HomeWorkspaceStatus({
  workspace,
  className,
  showLabel = false,
}: HomeWorkspaceStatusProps) {
  const group = getHomeTriageGroup(workspace);
  const explanation = (() => {
    switch (getHomeStatusCause(workspace)) {
      case 'failed':
        return m.home_status_failed();
      case 'blocked':
        return m.home_status_blocked();
      case 'review':
        return m.home_status_review();
      case 'question':
        return m.home_status_question();
      case 'pull-request':
        return m.home_status_pull_request();
      case 'running':
        return m.home_status_running();
      case 'merged':
        return m.home_status_merged();
      case 'complete':
        return m.home_status_complete();
      case 'unread':
        return m.home_status_unread();
      default:
        return m.home_status_idle();
    }
  })();
  const failed = workspace.displayStatus === 'failed';
  const presentation = (() => {
    switch (group) {
      case 'needs-you':
        return {
          label: m.home_filter_attention(),
          icon: faCircleQuestion,
          color: '',
        };
      case 'running':
        return { label: m.home_filter_running(), icon: null, color: 'text-primary' };
      case 'blocked':
        return {
          label: failed
            ? m.workspace_statusIcon_failed_label()
            : m.workspace_statusIcon_blocked_label(),
          icon: faCircleExclamation,
          color: failed ? 'text-danger' : 'text-warning-ink',
        };
      case 'done':
        return { label: m.home_board_done(), icon: faCircleCheck, color: 'text-success' };
      default:
        return { label: m.home_board_idle(), icon: null, color: 'text-muted-foreground' };
    }
  })();
  return (
    <TooltipProvider>
      <TooltipRoot>
        <TooltipTrigger asChild tabIndex={0}>
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 type-caption',
              presentation.color,
              className,
              group === 'needs-you' && 'needs-you',
            )}
            style={
              group === 'needs-you' ? { color: 'hsl(var(--workspace-status-unread))' } : undefined
            }
            role={showLabel ? undefined : 'img'}
            aria-label={showLabel ? undefined : `${presentation.label}. ${explanation}`}
            data-home-status={group}
            data-home-status-error={failed || undefined}
          >
            <span
              className="inline-flex size-4 shrink-0 items-center justify-center"
              aria-hidden="true"
            >
              {presentation.icon ? (
                <IconDefinitionIcon icon={presentation.icon} weight="fill" className="size-full!" />
              ) : (
                <span className="size-2 rounded-full bg-current" />
              )}
            </span>
            {showLabel && (
              <>
                <span>{presentation.label}</span>
                <span className="sr-only">{explanation}</span>
              </>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent>{explanation}</TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}
