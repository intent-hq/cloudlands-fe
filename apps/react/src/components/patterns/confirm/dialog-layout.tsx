import type { ReactNode } from 'react';
import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { InputMessage } from '@/components/ui/input-message';
import { cn } from '@/lib/utils';
import './dialog-layout.css';

export interface DialogLayoutProps {
  title: string;
  description?: string;
  titleId?: string;
  descriptionId?: string;
  children?: ReactNode;
  headerActions?: ReactNode;
  footer?: ReactNode;
  error?: string;
}

export function DialogLayout({
  title,
  description,
  titleId,
  descriptionId,
  children,
  headerActions,
  footer,
  error,
}: DialogLayoutProps) {
  return (
    <div className="react-dialog-layout flex min-h-0 min-w-0 flex-1 flex-col">
      <DialogHeader className={cn('m-0 shrink-0 px-6 pt-6', headerActions ? 'pr-22' : 'pr-14')}>
        {headerActions ? (
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <DialogTitle id={titleId}>{title}</DialogTitle>
            <div className="absolute right-14 top-[calc(1.5rem+var(--text-title-line-height)/2)] -translate-y-1/2">
              {headerActions}
            </div>
          </div>
        ) : (
          <DialogTitle id={titleId}>{title}</DialogTitle>
        )}
        {description && <DialogDescription id={descriptionId}>{description}</DialogDescription>}
      </DialogHeader>
      {(children || error) && (
        <div
          data-slot="dialog-body"
          className={cn(
            'min-h-0 min-w-0 overflow-y-auto overscroll-contain px-6 pt-5',
            footer ? 'pb-5' : 'pb-6',
          )}
        >
          <div className="grid min-w-0 grid-cols-1 gap-4">
            {children}
            {error && <InputMessage tone="error">{error}</InputMessage>}
          </div>
        </div>
      )}
      {footer ? (
        <DialogFooter className={children ? 'm-0 shrink-0 px-6 pb-6' : 'm-0 shrink-0 p-6'}>
          {footer}
        </DialogFooter>
      ) : (
        !children && <div className="h-6 shrink-0" aria-hidden="true" />
      )}
    </div>
  );
}
