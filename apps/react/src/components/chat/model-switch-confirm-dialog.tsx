// Source: src/lib/components/chat/ModelSwitchConfirmDialog.svelte.
import { ArrowRight } from '@phosphor-icons/react';
import { FormDialog } from '@/components/patterns/confirm';
import {
  AgentProviderIcon,
  hasProviderIcon,
} from '@/features/agent/components/agent-provider-icon';
import { m } from '$shared/paraglide/messages.js';

export interface ModelSwitchConfirmDialogProps {
  open?: boolean;
  static?: boolean;
  isProviderChange?: boolean;
  fromModelLabel?: string;
  toModelLabel?: string;
  fromProviderName?: string;
  toProviderName?: string;
  fromProviderId?: string;
  toProviderId?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

export function ModelSwitchConfirmDialog({
  open = false,
  static: staticPosition = false,
  isProviderChange = false,
  fromModelLabel = '',
  toModelLabel = '',
  fromProviderName = '',
  toProviderName = '',
  fromProviderId = '',
  toProviderId = '',
  onConfirm,
  onCancel,
}: ModelSwitchConfirmDialogProps) {
  return (
    <FormDialog
      open={open}
      static={staticPosition}
      title={
        isProviderChange
          ? m.chat_modelSwitchDialog_switchProvider_title()
          : m.chat_modelSwitchDialog_switchModel_title()
      }
      closeLabel={m.chat_modelSwitchDialog_close_ariaLabel()}
      submitLabel={
        isProviderChange
          ? m.chat_modelSwitchDialog_switchProvider_label()
          : m.chat_modelSwitchDialog_switchModel_label()
      }
      cancelLabel={m.chat_modelSwitchDialog_cancel_label()}
      focusSubmit
      onSubmit={() => onConfirm?.()}
      onCancel={onCancel}
    >
      <div className="flex min-w-0 items-center gap-3 type-body" data-testid="model-switch-models">
        <span className="inline-flex min-w-0 flex-1 items-center gap-1.5" title={fromProviderName}>
          {hasProviderIcon(fromProviderId) && (
            <span aria-hidden="true">
              <AgentProviderIcon providerId={fromProviderId} className="size-3.5" />
            </span>
          )}
          <span className="sr-only">{fromProviderName}</span>
          <span className="truncate" title={fromModelLabel}>
            {fromModelLabel}
          </span>
        </span>
        <ArrowRight size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="inline-flex min-w-0 flex-1 items-center gap-1.5" title={toProviderName}>
          {hasProviderIcon(toProviderId) && (
            <span aria-hidden="true">
              <AgentProviderIcon providerId={toProviderId} className="size-3.5" />
            </span>
          )}
          <span className="sr-only">{toProviderName}</span>
          <span className="truncate" title={toModelLabel}>
            {toModelLabel}
          </span>
        </span>
      </div>
      <p className="type-body text-muted-foreground">
        {isProviderChange
          ? m.chat_modelSwitchDialog_providerChange_description()
          : m.chat_modelSwitchDialog_modelChange_description()}
      </p>
      <p className="type-caption text-muted-foreground">
        {m.chat_modelSwitchDialog_deferred_description()}
      </p>
    </FormDialog>
  );
}
