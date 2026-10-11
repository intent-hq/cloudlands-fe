import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';
import { createFormatters } from '$shared/i18n/formatters';
import { getLocale } from '$shared/paraglide/runtime.js';
import { slotColorClasses } from '../../../../../../src/features/hardware-console/components/micro-key-slot-colors';

const { formatInteger } = createFormatters(getLocale);

export interface MicroKeySlotSquareProps {
  slot: number;
  size?: 'default' | 'compact';
  className?: string;
}

export function MicroKeySlotSquare({ slot, size = 'default', className }: MicroKeySlotSquareProps) {
  return (
    <span
      className={cn(
        'type-caption flex shrink-0 items-center justify-center rounded-[3px] border font-medium leading-none a11y-ignore',
        size === 'compact' ? 'size-3.5' : 'size-4',
        slotColorClasses(slot),
        className,
      )}
      title={m.workspace_microKeyBadge_tooltip({ number: formatInteger(slot + 1) })}
    >
      {formatInteger(slot + 1)}
    </span>
  );
}
