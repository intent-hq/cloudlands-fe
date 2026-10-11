// Source: src/lib/components/ui/message-composer/suggestion-row.svelte.
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Rich listbox options contain shortcuts and icons, and keep focus in the textarea. */
import { useLayoutEffect, useRef } from 'react';
import { ArrowDownIcon, ArrowElbowDownLeftIcon } from '@phosphor-icons/react';
import { ShortcutChip } from '@/components/ui/kbd';
import { menuItem } from '@/components/ui/menu';
import { proximityItem, type ProximityHover } from '@/lib/interaction';
import { cn } from '@/lib/utils';

export default function SuggestionRow({
  text,
  index,
  active,
  keyHint,
  shortcut,
  optionId,
  hover,
  compact = false,
  onSelect,
}: {
  text: string;
  index: number;
  active: boolean;
  keyHint: boolean;
  shortcut?: string;
  optionId: string;
  hover: ProximityHover;
  compact?: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    return proximityItem(ref.current, { hover, index }).destroy;
  }, [hover, index]);
  return (
    <div
      ref={ref}
      id={optionId}
      role="option"
      tabIndex={-1}
      aria-selected={active}
      onClick={onSelect}
      onKeyDown={(event) => event.key === 'Enter' && onSelect()}
      className={cn(
        menuItem(),
        'cursor-pointer px-2.5 text-muted-foreground',
        compact ? 'h-7 text-[13px]' : 'h-8 text-sm',
        active && 'text-foreground',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {shortcut && (
        <span className="inline-flex h-5 shrink-0 items-center rounded-sm border border-border bg-background px-1">
          <ShortcutChip>{shortcut}</ShortcutChip>
        </span>
      )}
      {!active && keyHint ? (
        <ArrowDownIcon size={13} className="shrink-0 opacity-70" aria-hidden="true" />
      ) : (
        <ArrowElbowDownLeftIcon
          size={13}
          className={cn(
            'shrink-0 transition-opacity duration-spring-fast',
            active ? 'opacity-100' : 'opacity-0',
          )}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
