// Source: src/lib/components/chat/input/EffortPicker.svelte.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { m } from '$shared/paraglide/messages.js';
import { pushEscapeLayer } from '$lib/utils/escapeLayers';
import { reasoningEffortLabel as levelLabel } from '../../../../../../src/features/agent/utils/reasoning-effort-label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { applyReasoningEffort } from '@/features/agent/reasoning-effort';
import { cn } from '@/lib/utils';
import { selectAgentReasoningEffort } from '@/store/agent-session/agent-session-selectors';
import { selectAgentModelEffortLevels } from '@/store/model/model-selectors';
import { EffortGauge } from './effort-gauge';

export interface EffortPickerProps {
  agentId?: string;
  workspaceId?: string;
  disabled?: boolean;
  /** Announce a pending commit without disabling the trigger or losing focus. */
  busy?: boolean;
  className?: string;
  mode?: 'popover' | 'embedded';
  effortLevels?: readonly string[];
  effort?: string | null;
  autoLabel?: string;
  modalAware?: boolean;
  onEffortChange?: (effort: string | null) => boolean | void | Promise<boolean | void>;
}

type EffortOption = {
  value: string;
  label: string;
  effort: string | null;
  levelIndex: number | null;
};

const AUTO_OPTION_VALUE = 'auto';

export function EffortPicker({
  agentId,
  workspaceId,
  disabled = false,
  busy = false,
  className = '',
  mode = 'popover',
  effortLevels = [],
  effort = null,
  autoLabel,
  modalAware = false,
  onEffortChange,
}: EffortPickerProps) {
  // The app's Signals transform tracks these ReactStore reads during render.
  const sessionLevels = selectAgentModelEffortLevels(agentId ?? '').value;
  const sessionEffort = selectAgentReasoningEffort(agentId ?? '').value;
  const embedded = mode === 'embedded';
  const levels = embedded ? effortLevels : (sessionLevels ?? []);
  const hasLevels = (embedded || !!agentId) && levels.length > 0;
  const controlDisabled = disabled || (!embedded && !workspaceId);
  const options: EffortOption[] = [
    {
      value: AUTO_OPTION_VALUE,
      label: autoLabel ?? m.chat_effortPicker_level_auto(),
      effort: null,
      levelIndex: null,
    },
    ...levels.map((level, index) => ({
      value: `effort-${index}`,
      label: levelLabel(level),
      effort: level,
      levelIndex: index,
    })),
  ];
  const selectItems = options.map(({ value, label }) => ({ value, label }));

  // Unsupported persisted values stay visible without adding selectable levels.
  const persistedValue = embedded ? effort : (sessionEffort ?? null);
  const supportedIndex = persistedValue == null ? -1 : levels.indexOf(persistedValue);
  const persistedOptionValue =
    persistedValue == null
      ? AUTO_OPTION_VALUE
      : supportedIndex >= 0
        ? `effort-${supportedIndex}`
        : `unsupported-${persistedValue}`;
  const [selection, setSelection] = useState({
    persisted: persistedOptionValue,
    value: persistedOptionValue,
  });
  if (selection.persisted !== persistedOptionValue) {
    setSelection({ persisted: persistedOptionValue, value: persistedOptionValue });
  }
  const selectedOptionValue = selection.value;
  const latestPersistedOptionValue = useRef(persistedOptionValue);
  const selectedOption = options.find((option) => option.value === selectedOptionValue);
  const selectedLabel =
    selectedOption?.label ??
    (persistedValue
      ? m.chat_effortPicker_unavailable_label({ level: levelLabel(persistedValue) })
      : m.chat_effortPicker_level_auto());
  const selectedLevelIndex = selectedOption?.levelIndex ?? -1;
  const [selectOpen, setSelectOpen] = useState(false);
  const pickerRoot = useRef<HTMLDivElement>(null);
  const contentId = useId();

  useLayoutEffect(() => {
    latestPersistedOptionValue.current = persistedOptionValue;
  }, [persistedOptionValue]);

  useEffect(() => {
    if (!modalAware || !selectOpen) return;
    return pushEscapeLayer(() => {
      setSelectOpen(false);
      queueMicrotask(() =>
        pickerRoot.current
          ?.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')
          ?.focus(),
      );
    });
  }, [modalAware, selectOpen]);

  async function commit(optionValue: string) {
    const option = options.find((candidate) => candidate.value === optionValue);
    if (!option || controlDisabled) return;

    // Auto must clear an unsupported persisted field, not merely match the UI default.
    const previous = persistedValue ?? null;
    if (option.effort === previous) return;

    const applied = embedded
      ? await onEffortChange?.(option.effort)
      : agentId && workspaceId
        ? await applyReasoningEffort(agentId, workspaceId, option.effort, previous)
        : false;
    if (applied === false) {
      const persisted = latestPersistedOptionValue.current;
      setSelection({ persisted, value: persisted });
    }
  }

  if (!hasLevels) return null;

  const title = (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        embedded && 'type-caption text-muted-foreground',
      )}
    >
      <span>{m.chat_effortPicker_title_label()}</span>
      {selectedLevelIndex >= 0 && (
        <EffortGauge
          value={selectedLevelIndex}
          max={Math.max(1, levels.length - 1)}
          className="[&_line]:transition-none!"
        />
      )}
    </span>
  );

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Preserve the source keyboard boundary around the nested Select, not an additional interactive control.
    <div
      ref={pickerRoot}
      className={cn(embedded ? 'flex items-center justify-between gap-3' : 'w-auto', className)}
      data-testid="effort-picker-content"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source labelled group without introducing fieldset layout or a second focus target.
      role="group"
      aria-label={m.chat_effortPicker_popover_ariaLabel()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !selectOpen) return;
        if (event.key === 'Escape') setSelectOpen(false);
        event.stopPropagation();
      }}
    >
      {embedded && title}
      <div className={cn(embedded ? 'w-32' : 'min-w-36')}>
        <Select
          value={selectedOptionValue}
          onValueChange={(value) => {
            setSelection({ persisted: persistedOptionValue, value });
            void commit(value);
          }}
          open={selectOpen}
          onOpenChange={setSelectOpen}
          items={selectItems}
          disabled={controlDisabled}
        >
          <SelectTrigger
            className="h-7 gap-1 px-2 text-xs"
            aria-label={m.chat_effortPicker_trigger_ariaLabel({ level: selectedLabel })}
            aria-controls={selectOpen ? contentId : undefined}
            aria-busy={busy || undefined}
            data-testid="effort-picker-trigger"
          >
            <span className="min-w-0 flex-1 truncate text-left">
              {!embedded && <>{title}· </>}
              {selectedLabel}
            </span>
          </SelectTrigger>
          <SelectContent
            wrapperId={contentId}
            portal
            dropUp={!embedded}
            className={cn(
              'w-max min-w-(--radix-select-trigger-width) max-h-[min(15rem,var(--radix-select-content-available-height))]!',
              // Nested choices must remain above their containing dropdown or modal.
              embedded && 'z-[calc(var(--layer-modal)+1)]!',
            )}
          >
            <SelectGroup>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value} label={option.label}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
