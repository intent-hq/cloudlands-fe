// Source: src/lib/components/settings/AutoSaveTextarea.svelte.
import { AutoSaveField } from '@/components/patterns/form';
import { Textarea } from '@/components/patterns/settings/custom-controls';
import { cn } from '@/lib/utils';
import { formatNumber } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import './auto-save-textarea.css';

export interface AutoSaveTextareaProps {
  /** Current value (can be a computed/derived value). */
  value: string;
  /** Original value for change detection. */
  originalValue?: string;
  placeholder?: string;
  minRows?: number;
  /** Maximum character limit (optional). */
  maxLength?: number;
  /** Called when value should be saved. */
  onSave: (value: string) => void | Promise<void>;
  className?: string;
}

export function AutoSaveTextarea({
  value,
  originalValue = '',
  placeholder = '',
  minRows = 8,
  maxLength,
  onSave,
  className = '',
}: AutoSaveTextareaProps) {
  return (
    <AutoSaveField
      value={value}
      originalValue={originalValue}
      onSave={onSave}
      prepare={(draft) => draft.trim()}
      canSave={(draft) => !maxLength || draft.length <= maxLength}
      className={cn('h-full flex flex-col gap-2', className)}
    >
      {(field) => {
        const charCount = field.value.length;
        const warningThreshold = maxLength ? Math.floor(maxLength * 0.8) : 0;
        const isOverLimit = maxLength ? charCount > maxLength : false;
        const isApproachingLimit = maxLength ? charCount > warningThreshold && !isOverLimit : false;
        const charCountPercentage = maxLength
          ? Math.min(100, Math.round((charCount / maxLength) * 100))
          : 0;

        return (
          <>
            <div className="auto-save-textarea-editor relative grow min-h-0 flex flex-col">
              <Textarea
                value={field.value}
                onChange={(event) => field.update(event.currentTarget.value)}
                onKeyDown={field.onKeyDown}
                onFocus={field.onFocus}
                onBlur={field.onBlur}
                placeholder={placeholder}
                rows={minRows}
                noFocusStyle
                className={cn('grow', isOverLimit && 'border-danger')}
              />
            </div>

            {Boolean(maxLength) && (isApproachingLimit || isOverLimit) && (
              <div
                className={cn(
                  'flex items-center justify-end type-caption shrink-0',
                  isOverLimit ? 'text-danger' : 'text-warning-ink',
                )}
              >
                <span>
                  {m.settings_autoSave_limitUsed({
                    percent: formatNumber(charCountPercentage / 100, {
                      style: 'percent',
                      maximumFractionDigits: 0,
                    }),
                  })}
                </span>
              </div>
            )}
          </>
        );
      }}
    </AutoSaveField>
  );
}
