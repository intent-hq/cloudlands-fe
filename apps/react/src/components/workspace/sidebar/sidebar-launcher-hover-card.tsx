import { useState, type ReactNode } from 'react';
import { TooltipRich } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface HoverCardRow {
  label?: string;
  text: string;
}

interface SidebarLauncherHoverCardProps {
  title: string;
  rows: HoverCardRow[];
  emptyText: string;
  kind: 'agent' | 'note';
  status?: string;
  statusTone?: 'success' | 'warning' | 'danger' | 'muted';
  delayDuration?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  gridPosition?: 'start' | 'center' | 'end';
  children?: ReactNode;
}

export function SidebarLauncherHoverCard({
  title,
  rows,
  emptyText,
  kind,
  status,
  statusTone = 'success',
  delayDuration = 400,
  open = false,
  onOpenChange,
  gridPosition = 'center',
  children,
}: SidebarLauncherHoverCardProps) {
  // The source child owns a bindable open value; a changed parent value resets it.
  const [openState, setOpenState] = useState({ supplied: open, current: open });
  if (openState.supplied !== open) {
    setOpenState({ supplied: open, current: open });
  }
  const visibleRows = rows.filter(({ text }) => text.trim().length > 0);
  const preview = (
    <div className="w-72 space-y-2" data-sidebar-hover-card={kind}>
      {status && (
        <span
          className={cn('inline-flex items-center gap-1 text-xs font-medium', {
            'text-success': statusTone === 'success',
            'text-warning-ink': statusTone === 'warning',
            'text-red-500': statusTone === 'danger',
            'text-muted-foreground': statusTone === 'muted',
          })}
        >
          <span
            className={cn('size-1.5 rounded-full', {
              'bg-success': statusTone === 'success',
              'bg-warning': statusTone === 'warning',
              'bg-red-500': statusTone === 'danger',
              'bg-muted-foreground': statusTone === 'muted',
            })}
            aria-hidden="true"
          />
          {status}
        </span>
      )}
      {visibleRows.length > 0 ? (
        visibleRows.map((row, index) => (
          <div
            key={index}
            className="space-y-0.5"
            data-sidebar-hover-row={row.label?.toLowerCase() || 'content'}
          >
            {row.label && <p className="text-xs font-medium text-muted-foreground">{row.label}</p>}
            <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm leading-snug text-foreground">
              {row.text}
            </p>
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      )}
    </div>
  );
  return (
    <TooltipRich
      title={title}
      content={preview}
      side="top"
      align="start"
      sideOffset={8}
      delayDuration={delayDuration}
      maxWidth="20rem"
      showArrow={false}
      className={cn({
        'justify-self-start': gridPosition === 'start',
        'justify-self-end': gridPosition === 'end',
        'justify-self-center': gridPosition === 'center',
      })}
      contentContainerClass="space-y-2"
      open={openState.supplied === open ? openState.current : open}
      onOpenChange={(next) => {
        setOpenState({ supplied: open, current: next });
        onOpenChange?.(next);
      }}
    >
      {children}
    </TooltipRich>
  );
}
