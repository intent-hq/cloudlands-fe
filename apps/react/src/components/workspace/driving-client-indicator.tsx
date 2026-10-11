import { GlobeIcon } from '@phosphor-icons/react';
import {
  resolveDrivingClientView,
  type DrivingClientInput,
} from '$lib/components/workspace/driving-indicator';
import { m } from '$shared/paraglide/messages.js';
import { TooltipRich } from '@/components/ui/tooltip-rich';
import { cn } from '@/lib/utils';

export type DrivingClientIndicatorProps = DrivingClientInput;

export function DrivingClientIndicator({
  eligibleClients,
  ownClientId,
  driving,
  hasBrowserTabs,
}: DrivingClientIndicatorProps) {
  const view = resolveDrivingClientView({ eligibleClients, ownClientId, driving, hasBrowserTabs });
  if (!view) return null;

  const label =
    view.mode === 'here'
      ? m.workspace_drivingClient_here_label()
      : view.mode === 'elsewhere'
        ? m.workspace_drivingClient_elsewhere_label({ host: view.hostName })
        : m.workspace_drivingClient_offline_label();
  const description =
    view.mode === 'here'
      ? m.workspace_drivingClient_here_description()
      : view.mode === 'elsewhere'
        ? m.workspace_drivingClient_elsewhere_description({ host: view.hostName })
        : m.workspace_drivingClient_offline_description({ host: view.hostName });

  return (
    <TooltipRich
      side="bottom"
      align="start"
      sideOffset={6}
      delayDuration={300}
      maxWidth="18rem"
      title={label}
      description={description}
      variant={view.mode === 'offline' ? 'warning' : 'default'}
      className="type-caption flex h-5 min-w-0 max-w-full cursor-default items-center gap-1.5 rounded-sm border-none bg-transparent p-0 text-left leading-5 text-muted-foreground"
      trigger={
        <span
          className="flex h-5 min-w-0 items-center gap-1.5 leading-5"
          data-sidebar-driving-client={view.mode}
          aria-label={label}
        >
          <span className="relative flex shrink-0 items-center" aria-hidden="true">
            <GlobeIcon
              size="0.75em"
              weight="regular"
              data-icon="globe"
              data-weight="regular"
              aria-hidden="true"
            />
            <span
              className={cn(
                'absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full',
                view.mode === 'here'
                  ? 'bg-success'
                  : view.mode === 'offline'
                    ? 'bg-danger'
                    : 'bg-muted-foreground/60',
              )}
            />
          </span>
          <span className="min-w-0 truncate">{label}</span>
        </span>
      }
    />
  );
}
