// Source: src/lib/components/workspace/sidebar/SidebarHeaderAction.svelte.
import type { MouseEventHandler, Ref } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SidebarActionIcon, type SidebarActionIconProps } from './sidebar-action-icon';

export interface SidebarHeaderActionProps {
  [attribute: `data-${string}`]: string | undefined;
  icon: SidebarActionIconProps['icon'];
  label: string;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  ref?: Ref<HTMLButtonElement>;
  className?: string;
}

export function SidebarHeaderAction({
  icon,
  label,
  onClick,
  ref,
  className = '',
  ...restProps
}: SidebarHeaderActionProps) {
  return (
    <Button
      {...restProps}
      ref={ref}
      iconOnly
      variant="plain"
      size="icon-compact"
      className={cn(
        className,
        'expanded-card-action rounded-md! border-0! bg-transparent! p-0! text-foreground shadow-none! outline-none transition-colors hover:bg-muted/50! focus-visible:border-transparent! focus-visible:bg-muted! motion-reduce:transition-none forced-colors:hover:outline forced-colors:focus-visible:outline',
      )}
      tooltip={label}
      tooltipSide="top"
      tooltipDelayDuration={300}
      aria-label={label}
      onClick={onClick}
      data-sidebar-action={icon}
      data-sidebar-close={icon === 'close' ? '' : undefined}
    >
      <SidebarActionIcon icon={icon} />
    </Button>
  );
}
