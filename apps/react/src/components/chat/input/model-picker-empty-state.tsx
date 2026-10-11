// Source: src/lib/components/chat/input/ModelPickerEmptyState.svelte.
import { useRef } from 'react';
import { ArrowsClockwiseIcon, GearIcon, WarningIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { crispOut, springIn, usePresenceTransition } from '@/lib/motion';
import type { ProviderLoadError } from '$lib/components/chat/input/provider-load-error';
import { m } from '$shared/paraglide/messages.js';

export interface ModelPickerEmptyStateProps {
  isLoadingModels: boolean;
  retryInFooter?: boolean;
  blockingLoadError: ProviderLoadError | null;
  hasNoAvailableProvider?: boolean;
  hostManaged?: boolean;
  onOpenProviderSettings: () => void;
  onRetry: () => void;
  /** The parent retains this component until its source outro completes. */
  present?: boolean;
  onExit?: () => void;
}

const transition =
  (node: HTMLElement) =>
  ({ direction = 'in' }: { direction?: 'in' | 'out' } = {}) =>
    direction === 'in'
      ? springIn(node, { tier: 'fast', y: 0, scale: 1 })
      : crispOut(node, { tier: 'fast' });
const noExit = () => {};

export function ModelPickerEmptyState({
  isLoadingModels,
  retryInFooter = false,
  blockingLoadError,
  hasNoAvailableProvider = false,
  hostManaged = false,
  onOpenProviderSettings,
  onRetry,
  present = true,
  onExit = noExit,
}: ModelPickerEmptyStateProps) {
  const root = useRef<HTMLDivElement>(null);
  usePresenceTransition(root, present, onExit, transition);

  // The dropdown supplies the option-list container; branches keep its row padding.
  return (
    <div ref={root} className="py-1 text-left">
      {hasNoAvailableProvider ? (
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source live status region containing provider guidance and its settings action.
        <div className="flex items-start gap-2.5 px-2 py-3" role="status">
          <div className="min-w-0">
            <div className="type-body font-medium text-foreground">
              {m.chat_modelPicker_noProviderAvailable_title()}
            </div>
            <div className="type-caption mt-0.5 leading-snug text-subtle">
              {hostManaged
                ? m.hostExecution_providerSetup_description()
                : m.chat_modelPicker_noProviderAvailable_description()}
            </div>
            {!hostManaged && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={onOpenProviderSettings}
              >
                <GearIcon weight="regular" className="h-3 w-3" aria-hidden="true" />
                {m.chat_modelPicker_noProviderAvailable_openSettings_label()}
              </Button>
            )}
          </div>
          <WarningIcon
            weight="regular"
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-ink"
            aria-hidden="true"
          />
        </div>
      ) : isLoadingModels ? (
        [4, 3].map((itemCount, i) => (
          <div key={i}>
            <div className="px-2 pt-3 pb-1 flex items-start gap-2">
              <div className="h-3 w-16 bg-muted/60 rounded animate-pulse" />
              <div className="size-3.5 rounded bg-muted/60 animate-pulse" />
            </div>
            {Array.from({ length: itemCount }, (_, j) => (
              <div key={j} className="px-2 py-2 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div
                    className="h-3.5 rounded bg-muted/40 animate-pulse"
                    style={{
                      width: `${60 + ((j * 17 + i * 23) % 30)}%`,
                      // Keep the source skeleton's pulse stagger, rather than the shared shimmer.
                      animationDelay: `${(i * itemCount + j) * 75}ms`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        ))
      ) : blockingLoadError ? (
        <div className="flex flex-col items-start gap-2.5 py-4 px-2 text-left">
          <div className="flex items-start gap-1.5 text-danger">
            <span className="type-body font-medium">{m.chat_modelPicker_loadFailed_label()}</span>
            <WarningIcon weight="regular" className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
          <div className="type-caption max-w-[280px] whitespace-normal [overflow-wrap:anywhere] text-left leading-tight text-muted-foreground">
            <div>{blockingLoadError.displayText}</div>
            {blockingLoadError.hint && (
              <div className="mt-1 text-subtle">{blockingLoadError.hint}</div>
            )}
          </div>
          {!retryInFooter && (
            <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
              <ArrowsClockwiseIcon weight="regular" className="h-3 w-3" aria-hidden="true" />
              {m.chat_modelPicker_retry_label()}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2.5 py-4 px-2 text-left text-muted-foreground">
          <span className="type-body">{m.chat_modelPicker_noModels_label()}</span>
          {!retryInFooter && (
            <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
              <ArrowsClockwiseIcon weight="regular" className="h-3 w-3" aria-hidden="true" />
              {m.chat_modelPicker_retry_label()}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
