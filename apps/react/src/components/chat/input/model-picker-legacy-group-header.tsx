// Source: src/lib/components/chat/input/ModelPickerLegacyGroupHeader.svelte.
import { CaretDownIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';

export interface ModelPickerLegacyGroupHeaderProps {
  group: { label: string };
  groupIndex: number;
  expanded: boolean;
  disabled?: boolean;
  onToggle: () => void;
}

export function ModelPickerLegacyGroupHeader({
  group,
  groupIndex,
  expanded,
  disabled = false,
  onToggle,
}: ModelPickerLegacyGroupHeaderProps) {
  return (
    <Button
      variant="ghost-light"
      className={cn(
        'group type-caption h-auto w-full justify-start rounded-none border-x-0 border-b-0 border-t border-border px-2 pb-1.5 pt-2.5 font-medium text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground aria-disabled:opacity-100',
        groupIndex > 0 && 'mt-1.5',
        disabled && 'cursor-default hover:bg-transparent hover:text-muted-foreground',
      )}
      aria-label={m.chat_modelPicker_legacyModels_ariaLabel()}
      aria-expanded={expanded}
      aria-disabled={disabled}
      onClick={() => {
        if (!disabled) onToggle();
      }}
      onKeyDown={(event) => {
        if (disabled || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      <span>{group.label}</span>
      <CaretDownIcon
        weight="regular"
        className={cn(
          'ml-auto size-4 shrink-0 text-subtle transition-[color,transform] duration-spring-fast ease-spring-fast motion-reduce:transition-none group-hover:text-muted-foreground',
          !expanded && 'rotate-90',
        )}
        aria-hidden="true"
      />
    </Button>
  );
}
