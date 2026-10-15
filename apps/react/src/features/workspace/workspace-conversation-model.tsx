import { useEffect, useRef, useState } from 'react';
import { ModelPicker, type ModelPickerProps } from '@/components/chat/input/model-picker';
import {
  ModelSwitchConfirmDialog,
  type ModelSwitchConfirmDialogProps,
} from '@/components/chat/model-switch-confirm-dialog';
import { ContentDialog } from '@/components/patterns/confirm';
import { SettingsSection, SettingsFieldRow } from '@/components/patterns/settings';
import {
  selectAgentSession,
  selectAgentProvider,
} from '@/store/agent-session/agent-session-selectors';
import { selectWorkspaceParticipationContext } from '@/store/workspace/workspace-selectors';
import { selectPrincipalConnectionContext } from '@/store/principal/principal-selectors';
import { selectAgentModelWriteSnapshot } from '@/store/agent-model/agent-model-selectors';
import {
  selectContextProviderEntries,
  selectContextDefaultProvider,
  selectContextModelProviderIds,
} from '@/store/provider-catalog/workspace-catalog-selectors';
import { canChangeAgentProvider } from '$lib/components/chat/provider-lock';
import { m } from '$shared/paraglide/messages.js';

/** Session controls retain the canonical picker, catalog leases and mutation owner. */
export function WorkspaceConversationModel(props: {
  workspaceId: string;
  agentId: string;
  disabled: boolean;
  responding: boolean;
  triggerClass?: string;
}) {
  const connection = selectPrincipalConnectionContext().value;
  const participation = selectWorkspaceParticipationContext(props.workspaceId).value;
  return (
    <ConversationModelHost
      key={JSON.stringify([props.workspaceId, props.agentId, connection, participation])}
      {...props}
    />
  );
}

function ConversationModelHost({
  workspaceId,
  agentId,
  disabled,
  responding,
  triggerClass,
}: {
  workspaceId: string;
  agentId: string;
  disabled: boolean;
  responding: boolean;
  triggerClass?: string;
}) {
  const session = selectAgentSession(agentId).value;
  const provider = selectAgentProvider(agentId).value;
  const snapshot = selectAgentModelWriteSnapshot(agentId, workspaceId).value;
  const providers = selectContextProviderEntries(workspaceId).value;
  const configured = selectContextModelProviderIds(workspaceId).value;
  const defaultProvider = selectContextDefaultProvider(workspaceId).value;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<ModelSwitchConfirmDialogProps | null>(null);
  const resolver = useRef<((result: boolean) => void) | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      resolver.current?.(false);
      resolver.current = undefined;
    };
  }, []);
  function settle(confirmed: boolean) {
    resolver.current?.(confirmed);
    resolver.current = undefined;
    setConfirmation(null);
  }
  const confirmChange: NonNullable<ModelPickerProps['confirmModelChange']> = (from, to, labels) => {
    if (!alive.current || disabled || !snapshot.canWrite || !snapshot.connection) return false;
    if (canChangeAgentProvider({ session: session ?? null, messages: session?.messages ?? [] }))
      return true;
    resolver.current?.(false);
    const fromProviderId = labels?.fromProviderId ?? provider;
    const toProviderId = labels?.toProviderId ?? provider;
    const name = (id: string | undefined) =>
      providers.find((p) => p.id === id)?.displayName ?? id ?? '';
    setConfirmation({
      isProviderChange: fromProviderId !== toProviderId,
      fromModelLabel: labels?.from ?? from ?? m.chat_richInput_defaultModel_label(),
      toModelLabel: labels?.to ?? to ?? m.chat_richInput_defaultModel_label(),
      fromProviderId,
      toProviderId,
      fromProviderName: name(fromProviderId),
      toProviderName: name(toProviderId),
    });
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  };
  if (!session || session.workspaceId !== workspaceId) return null;
  return (
    <div className="min-w-0" data-testid="conversation-model-controls">
      <ModelPicker
        triggerClass={triggerClass}
        selectedModel={session.model}
        providerId={provider}
        workspaceId={workspaceId}
        agentId={agentId}
        variant="ghost-light"
        size="xs"
        isLocked={disabled || !snapshot.canWrite || !snapshot.connection}
        updateGlobalStore
        updateGlobalDefault={false}
        showReasoning
        reasoningDisabled={disabled}
        deferUpdate={responding}
        confirmModelChange={confirmChange}
        onOpenProviderSettings={() => setSettingsOpen(true)}
      />
      <ModelSwitchConfirmDialog
        {...confirmation}
        open={confirmation !== null}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
      <ContentDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title={m.settings_sidebar_providers_label()}
        description={m.react_providerSettings_scope_description()}
      >
        <SettingsSection title={m.settings_providers_groupEnabled_label()}>
          {providers
            .filter((p) => configured.includes(p.id))
            .map((p) => (
              <SettingsFieldRow
                key={p.id}
                id={`conversation-provider-${p.id}`}
                label={p.displayName}
                description={
                  p.id === defaultProvider ? m.chat_modelPicker_providerDefault_label() : undefined
                }
              >
                <span className="type-body text-muted-foreground">
                  {m.settings_providers_groupDiscovered_label()}
                </span>
              </SettingsFieldRow>
            ))}
        </SettingsSection>
      </ContentDialog>
    </div>
  );
}
