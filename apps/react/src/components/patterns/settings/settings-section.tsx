// Source: src/lib/components/patterns/settings/SettingsSection.svelte.
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SettingsSectionProps {
  id?: string;
  title: string;
  description?: string;
  busy?: boolean;
  error?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  class?: string;
}
export function SettingsSection({
  id,
  title,
  description,
  busy = false,
  error,
  actions,
  children,
  className,
  class: legacyClass,
}: SettingsSectionProps) {
  const titleId = id ? `${id}-title` : undefined;
  const descriptionId = id && description ? `${id}-description` : undefined;
  const errorId = id && error ? `${id}-error` : undefined;
  return (
    <section
      id={id}
      data-highlight-id={id}
      data-slot="settings-section"
      className={cn('min-w-0 scroll-mt-20', legacyClass, className)}
      aria-labelledby={titleId}
      aria-label={titleId ? undefined : title}
      aria-describedby={[descriptionId, errorId].filter(Boolean).join(' ') || undefined}
      aria-busy={busy || undefined}
    >
      <header className="space-y-1">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 sm:flex-nowrap">
          <h2 id={titleId} className="type-title min-w-0 break-words text-foreground">
            {title}
          </h2>
          {actions != null && <div className="max-w-full shrink-0">{actions}</div>}
        </div>
        {description && (
          <p id={descriptionId} className="type-body max-w-2xl text-muted-foreground">
            {description}
          </p>
        )}
      </header>
      {error && (
        <p id={errorId} className="type-body mt-2 text-danger" role="alert">
          {error}
        </p>
      )}
      <div
        data-slot="settings-section-content"
        className="mt-4 min-w-0 divide-y divide-border rounded-(--radius-medium) bg-card"
      >
        {children}
      </div>
    </section>
  );
}
