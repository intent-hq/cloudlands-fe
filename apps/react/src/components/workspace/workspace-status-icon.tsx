import {
  CheckCircleIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  HourglassIcon,
  QuestionIcon,
  WarningIcon,
  XIcon,
  type Icon,
} from '@phosphor-icons/react';
import {
  getWorkspaceStatusPresentation,
  type WorkspaceStatusPresentationState,
} from '$lib/components/workspace/utils/workspace-status-presentation';
import { cn } from '@/lib/utils';
import './workspace-status-icon.css';

export interface WorkspaceStatusIconProps {
  status: WorkspaceStatusPresentationState;
  size?: number;
  decorative?: boolean;
  className?: string;
}

// Exact FaWrapper mappings; both hourglass definitions use the same regular glyph.
const statusIcons: Record<string, Icon> = {
  'circle-check': CheckCircleIcon,
  'circle-question': QuestionIcon,
  'code-merge': GitMergeIcon,
  'code-pull-request': GitPullRequestIcon,
  hourglass: HourglassIcon,
  'hourglass-half': HourglassIcon,
  'triangle-exclamation': WarningIcon,
  xmark: XIcon,
};

export function WorkspaceStatusIcon({
  status,
  size = 14,
  decorative = false,
  className,
}: WorkspaceStatusIconProps) {
  const presentation = getWorkspaceStatusPresentation(status);
  const StatusIcon = presentation.icon ? statusIcons[presentation.icon.iconName] : undefined;

  return (
    <span
      className={cn(
        'workspace-status-icon inline-flex shrink-0 items-center justify-center forced-colors:text-[CanvasText]',
        presentation.className,
        className,
      )}
      style={{ width: size, height: size }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : presentation.accessibleName}
      aria-hidden={decorative ? true : undefined}
      title={decorative ? undefined : presentation.tooltip}
      data-workspace-status={presentation.state}
      data-workspace-status-visual={presentation.visual}
      data-workspace-status-icon={presentation.icon?.iconName}
    >
      {presentation.visual === 'dot' ? (
        <span className="workspace-status-dot" data-workspace-status-dot="" />
      ) : StatusIcon ? (
        <StatusIcon
          className="size-full!"
          size="1em"
          weight="regular"
          data-icon={presentation.icon?.iconName}
          data-weight="regular"
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
}
