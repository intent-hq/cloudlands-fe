// Source: src/lib/components/patterns/settings/SettingsFieldRow.svelte.
import type { MouseEvent, ReactNode } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import './settings.css';

export interface SettingsFieldContext {
  labelId: string;
  descriptionId?: string;
  errorId?: string;
  disabled: boolean;
  busy: boolean;
}

export interface SettingsFieldRowProps {
  id: string;
  label: string;
  description?: string;
  htmlFor?: string;
  activateLabel?: boolean;
  error?: string;
  status?: string;
  statusTone?: 'info' | 'subtle';
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
  searchText?: string;
  danger?: boolean;
  experimental?: boolean;
  featureCode?: string;
  controlOnly?: boolean;
  leading?: ReactNode;
  descriptionContent?: ReactNode | (() => ReactNode);
  control?: (context: SettingsFieldContext) => ReactNode;
  children?: ReactNode;
  className?: string;
  class?: string;
}

export function SettingsFieldRow({
  id,
  label,
  description,
  htmlFor,
  activateLabel = false,
  error,
  status,
  statusTone = 'info',
  disabled = false,
  busy = false,
  compact = false,
  searchText = label,
  danger = false,
  experimental = false,
  featureCode,
  controlOnly = false,
  leading,
  descriptionContent,
  control,
  children,
  className,
  class: legacyClass,
}: SettingsFieldRowProps) {
  useSignals();
  const labelId = `${id}-label`;
  const descriptionId = description || descriptionContent ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const orientation = controlOnly ? 'full-width' : compact ? 'stacked' : 'responsive';
  function handleLabelClick(event: MouseEvent<HTMLLabelElement>) {
    if (!activateLabel || !htmlFor) return;
    event.preventDefault();
    if (disabled || busy) return;
    const target = event.currentTarget.ownerDocument.getElementById(htmlFor);
    target?.focus();
    target?.click();
  }
  return (
    <div
      id={id}
      data-slot="settings-field-row"
      data-highlight-id={id}
      data-settings-search-text={searchText}
      data-settings-feature-code={featureCode}
      data-danger={danger || undefined}
      data-experimental={experimental || undefined}
      data-disabled={disabled || undefined}
      data-orientation={orientation}
      aria-busy={busy || undefined}
      className={cn(
        'grid min-w-0 gap-3 py-3 first:pt-3 last:pb-3',
        controlOnly || compact
          ? 'grid-cols-1'
          : 'md:grid-cols-[minmax(0,1fr)_minmax(12rem,auto)] md:items-start md:gap-8',
        legacyClass,
        className,
      )}
    >
      {!controlOnly && (
        <div className="flex min-w-0 items-start gap-3">
          {leading != null && (
            <div
              data-field-leading
              aria-hidden="true"
              className={cn(
                'type-body first-line-icon',
                !compact && 'md:mt-[max(0px,calc((var(--control-height-medium)-1lh)/2))]',
              )}
            >
              {leading}
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-1 break-words">
            {htmlFor ? (
              <Label
                id={labelId}
                data-field-label
                htmlFor={htmlFor}
                onClick={activateLabel ? handleLabelClick : undefined}
                className={cn(
                  'type-body block font-medium text-foreground',
                  activateLabel && !disabled && !busy && 'cursor-pointer',
                  !compact && 'md:py-[max(0px,calc((var(--control-height-medium)-1lh)/2))]',
                )}
              >
                {label}
              </Label>
            ) : (
              <div
                id={labelId}
                data-field-label
                className={cn(
                  'type-body font-medium text-foreground',
                  !compact && 'md:py-[max(0px,calc((var(--control-height-medium)-1lh)/2))]',
                )}
              >
                {label}
              </div>
            )}
            {(description || descriptionContent) && (
              <p id={descriptionId} className="type-body text-muted-foreground">
                {descriptionContent
                  ? typeof descriptionContent === 'function'
                    ? descriptionContent()
                    : descriptionContent
                  : description}
              </p>
            )}
            {error ? (
              <p id={errorId} className="type-body text-danger" role="alert">
                {error}
              </p>
            ) : (
              status && (
                <output
                  className={cn(
                    'block type-body',
                    statusTone === 'subtle' ? 'text-ghost' : 'text-info',
                  )}
                >
                  {status}
                </output>
              )
            )}
          </div>
        </div>
      )}
      <div
        data-field-control
        data-orientation={orientation}
        className={cn(
          'w-full min-w-0 max-w-full',
          !controlOnly &&
            !compact &&
            'md:grid md:min-h-(--control-height-medium) md:content-center md:justify-items-end',
          controlOnly || compact ? 'md:justify-self-stretch' : 'md:w-auto md:justify-self-end',
          disabled && 'opacity-60',
        )}
      >
        {control ? control({ labelId, descriptionId, errorId, disabled, busy }) : children}
      </div>
    </div>
  );
}
