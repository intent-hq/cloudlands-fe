// Source: src/lib/components/ui/settings-page-shell/settings-page-shell.svelte.
import { useState, type MouseEventHandler, type ReactNode } from 'react';
import { m } from '$shared/paraglide/messages.js';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import './settings-page-shell.css';

export interface SettingsPageShellProps {
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  backShortcut?: string;
  backShortcutLabel?: string;
  onBack?: MouseEventHandler<HTMLButtonElement>;
  busy?: boolean;
  measure?: 'standard' | 'wide';
  navigationValue?: string;
  navigationLabel?: string;
  onNavigationValueChange?: (value: string) => void;
  navigation?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  class?: string;
  contentClass?: string;
}
export function SettingsPageShell({
  title,
  description,
  backHref,
  backLabel = m.settings_back_back(),
  backShortcut,
  backShortcutLabel,
  onBack,
  busy = false,
  measure = 'standard',
  navigationValue,
  navigationLabel,
  onNavigationValueChange,
  navigation,
  children,
  footer,
  className,
  class: legacyClass,
  contentClass,
}: SettingsPageShellProps) {
  const [localValue, setLocalValue] = useState('');
  return (
    <section
      data-slot="settings-page-shell"
      className={cn(
        'settings-page-shell-layout grid h-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground',
        legacyClass,
        className,
      )}
      aria-label={title}
      aria-busy={busy || undefined}
    >
      <header
        data-slot="settings-page-header"
        className="min-w-0 border-b border-border bg-card shadow-(--elevation-raised)"
      >
        <div
          data-slot="settings-page-header-inner"
          data-measure="wide"
          className="settings-measure-wide mx-auto w-full px-4 pt-4 sm:px-6 sm:pt-5"
        >
          {(onBack || backHref) && (
            <Button
              href={onBack ? undefined : backHref}
              onClick={onBack}
              variant="ghost"
              size="sm"
              className="mb-3 -ml-2"
              aria-label={backLabel}
            >
              <span>{backLabel}</span>
              {backShortcut && (
                <kbd
                  data-slot="settings-page-back-shortcut"
                  className="type-caption ml-1 rounded-sm border border-border bg-muted px-1.5 py-0.5 text-muted-foreground"
                  aria-label={backShortcutLabel}
                  aria-hidden={backShortcutLabel ? undefined : true}
                >
                  {backShortcut}
                </kbd>
              )}
            </Button>
          )}
          <div className="min-w-0 space-y-1.5 pb-5">
            <h1 className="type-display break-words text-foreground">{title}</h1>
            {description && (
              <p className="type-body max-w-2xl text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {navigation != null && (
          <div data-slot="settings-page-navigation" className="min-w-0 max-w-full">
            <div className="settings-measure-wide mx-auto w-full px-4 pb-2 sm:px-6">
              <div className="max-w-full overflow-x-auto overscroll-x-contain">
                <Tabs
                  value={navigationValue ?? localValue}
                  onValueChange={(value) => {
                    setLocalValue(value);
                    onNavigationValueChange?.(value);
                  }}
                >
                  <TabsList
                    className="min-w-max max-w-none [&_[role=tab]]:whitespace-nowrap"
                    aria-label={navigationLabel}
                  >
                    {navigation}
                  </TabsList>
                </Tabs>
              </div>
            </div>
          </div>
        )}
      </header>
      <div data-slot="settings-page-content-scroll" className="min-h-0 min-w-0 overflow-auto">
        <div className="settings-measure-wide mx-auto w-full">
          <div
            data-slot="settings-page-content"
            data-measure={measure}
            className={cn(
              'w-full min-w-0 space-y-10 px-4 py-6 sm:px-6 sm:py-8',
              measure === 'wide' ? 'settings-measure-wide' : 'settings-measure-form',
              contentClass,
            )}
          >
            {children}
          </div>
        </div>
      </div>
      {footer != null && (
        <footer
          data-slot="settings-page-footer"
          className="type-body min-w-0 border-t border-border bg-card text-muted-foreground shadow-(--elevation-raised)"
        >
          <div
            data-slot="settings-page-footer-inner"
            data-measure="wide"
            className="settings-measure-wide mx-auto w-full px-4 py-3 sm:px-6"
          >
            {footer}
          </div>
        </footer>
      )}
    </section>
  );
}
