import type { ReactNode } from 'react';
import { ShortcutChip } from '@/components/ui/kbd';
import { useSize } from '@/components/ui/size-context';
import { cn } from '@/lib/utils';

export interface FormActionsProps {
  destructive?: ReactNode;
  secondary?: ReactNode;
  primary: ReactNode;
  hint?: string;
  className?: string;
}

export function FormActions({
  destructive,
  secondary,
  primary,
  hint,
  className,
}: FormActionsProps) {
  const size = useSize();
  return (
    <div
      data-slot="form-actions"
      data-size={size}
      className={cn(
        'flex items-center justify-between',
        size === 'compact' ? 'gap-2' : 'gap-3',
        className,
      )}
    >
      <div data-slot="form-actions-destructive" className="flex items-center">
        {destructive}
      </div>
      <div data-slot="form-actions-end" className="ml-auto flex items-center gap-2">
        {hint && <ShortcutChip>{hint}</ShortcutChip>}
        {secondary}
        {primary}
      </div>
    </div>
  );
}
