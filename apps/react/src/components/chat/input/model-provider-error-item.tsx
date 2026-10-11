// Source: src/lib/components/chat/input/ModelProviderErrorItem.svelte.
import { WarningIcon } from '@phosphor-icons/react';

export interface ModelProviderErrorItemProps {
  providerId: string;
  providerLabel: string;
  error: string;
  hint?: string;
  compact?: boolean;
}

export function ModelProviderErrorItem({
  providerLabel,
  error,
  hint,
  compact = false,
}: ModelProviderErrorItemProps) {
  const displayText = `${providerLabel}: ${error}`;

  return (
    <>
      <WarningIcon
        weight="regular"
        className={
          compact
            ? 'h-3 w-3 text-warning-ink shrink-0 mt-0.5'
            : 'h-3.5 w-3.5 text-warning-ink shrink-0 mt-0.5'
        }
        aria-hidden="true"
      />
      <div
        className={
          compact
            ? 'min-w-0 whitespace-normal [overflow-wrap:anywhere] leading-tight'
            : 'flex-1 min-w-0 whitespace-normal [overflow-wrap:anywhere]'
        }
      >
        {compact ? (
          <>
            <span className="font-medium text-foreground">{displayText}</span>
            {hint && <span className="text-subtle"> {hint}</span>}
          </>
        ) : (
          <>
            <div className="type-caption font-medium leading-tight text-foreground">
              {displayText}
            </div>
            {hint && <div className="type-caption mt-0.5 leading-tight text-subtle">{hint}</div>}
          </>
        )}
      </div>
    </>
  );
}
