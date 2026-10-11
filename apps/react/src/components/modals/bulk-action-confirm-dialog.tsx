// Source: src/lib/components/modals/BulkActionConfirmDialog.svelte.
import { useState, type ReactNode } from 'react';
import type { ButtonVariant } from '@/components/ui/button';
import { DestructiveConfirm } from '@/components/patterns/confirm';
import { m } from '$shared/paraglide/messages.js';
import { createFormatters } from '$shared/i18n/formatters';
import { getLocale } from '$shared/paraglide/runtime.js';

const { formatInteger } = createFormatters(getLocale);

export interface BulkActionConfirmDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  static?: boolean;
  title?: string;
  description?: string;
  confirmText?: string;
  variant?: ButtonVariant;
  initialFocus?: 'confirm' | 'cancel';
  body?: ReactNode;
  /** Picks the guest-removal note: archive adds the re-invite reminder. */
  mode?: 'delete' | 'archive';
  /** Streaming agents across the targeted workspaces that the action would stop. */
  activeAgentCount?: number;
  /** Active background hooks across the targeted workspaces that the action would cancel. */
  activeHookCount?: number;
  /** Open pull requests across the targeted workspaces. */
  openPrCount?: number;
  /** Whether active-work preflight has resolved for the current target snapshot. */
  preflightReady?: boolean;
  /** Collaborators + open invites across the targeted workspaces that the action would remove. */
  guestCount?: number;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
}

export function BulkActionConfirmDialog({
  open = false,
  onOpenChange,
  static: staticPosition = false,
  title = m.modals_bulkActionConfirm_title(),
  description = '',
  confirmText = m.modals_bulkActionConfirm_confirm_label(),
  variant = 'default',
  initialFocus = 'confirm',
  body,
  openPrCount = 0,
  preflightReady = true,
  mode = 'delete',
  activeAgentCount = 0,
  activeHookCount = 0,
  guestCount = 0,
  onConfirm,
  onCancel,
}: BulkActionConfirmDialogProps) {
  const [isOpen, setIsOpen] = useState(open);
  const [previousOpen, setPreviousOpen] = useState(open);
  if (previousOpen !== open) {
    setPreviousOpen(open);
    setIsOpen(open);
  }

  const hasActiveWork =
    activeAgentCount > 0 || activeHookCount > 0 || openPrCount > 0 || guestCount > 0;

  function changeOpen(next: boolean) {
    setIsOpen(next);
    onOpenChange?.(next);
  }

  async function handleConfirm() {
    await onConfirm?.();
    changeOpen(false);
  }

  return (
    <DestructiveConfirm
      open={isOpen}
      onOpenChange={changeOpen}
      static={staticPosition}
      title={title}
      confirmLabel={confirmText}
      submitBusy={!preflightReady}
      canSubmit={preflightReady}
      focusSubmit={preflightReady && initialFocus === 'confirm'}
      focusCancel={!preflightReady || initialFocus === 'cancel'}
      enterKey={initialFocus === 'cancel' ? 'ignore' : 'submit'}
      modEnter={initialFocus === 'cancel' ? 'ignore' : 'submit'}
      destructive={variant === 'destructive'}
      onConfirm={handleConfirm}
      onCancel={onCancel}
      details={
        <div className="space-y-4">
          {description && <p className="type-body">{description}</p>}
          {hasActiveWork && (
            <div className="space-y-2">
              {activeAgentCount > 0 && (
                <p className="type-body text-foreground font-medium">
                  {activeAgentCount === 1
                    ? m.modals_deleteWarning_agentsStopped_one({
                        count: formatInteger(activeAgentCount),
                      })
                    : m.modals_deleteWarning_agentsStopped_many({
                        count: formatInteger(activeAgentCount),
                      })}
                </p>
              )}
              {activeHookCount > 0 && (
                <p className="type-body text-foreground font-medium">
                  {activeHookCount === 1
                    ? m.modals_deleteWarning_hooksCancelled_one({
                        count: formatInteger(activeHookCount),
                      })
                    : m.modals_deleteWarning_hooksCancelled_many({
                        count: formatInteger(activeHookCount),
                      })}
                </p>
              )}
              {openPrCount > 0 && (
                <p className="type-body text-muted-foreground font-normal">
                  {openPrCount === 1
                    ? m.modals_deleteWarning_openPrs_one({ count: formatInteger(openPrCount) })
                    : m.modals_deleteWarning_openPrs_many({ count: formatInteger(openPrCount) })}
                </p>
              )}
              {guestCount > 0 && (
                <p className="type-body text-muted-foreground font-normal">
                  {guestCount === 1
                    ? m.modals_bulkActionConfirm_guestsRemoved_one({
                        count: formatInteger(guestCount),
                      })
                    : m.modals_bulkActionConfirm_guestsRemoved_many({
                        count: formatInteger(guestCount),
                      })}
                  {mode === 'archive' && (
                    <> {m.modals_bulkActionConfirm_guestsReinvite_description()}</>
                  )}
                </p>
              )}
            </div>
          )}
          {body}
        </div>
      }
    />
  );
}
