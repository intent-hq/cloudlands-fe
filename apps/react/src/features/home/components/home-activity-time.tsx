import { RelativeTime } from '@/components/ui/relative-time';
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { Workspace } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import { homeActivity } from '../../../../../../src/features/home/home-activity';

interface HomeActivityTimeProps {
  workspace: Workspace;
}

export function HomeActivityTime({ workspace }: HomeActivityTimeProps) {
  const activity = homeActivity(workspace);
  const label =
    activity.source === 'content'
      ? m.home_activity_content()
      : activity.source === 'created'
        ? m.home_activity_created()
        : m.home_activity_unknown();

  return (
    <TooltipProvider>
      <TooltipRoot>
        <TooltipTrigger asChild tabIndex={0}>
          <span aria-label={label}>
            {activity.time > 0 ? (
              <RelativeTime date={activity.time} compact />
            ) : (
              <span aria-hidden="true">—</span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}
