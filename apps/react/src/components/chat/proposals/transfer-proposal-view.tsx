import { useState } from 'react';
import type { WorkspaceTransferProposal } from '$shared/types/proposal';
import type { ProposalLifecycleEntry } from '../../../../../../src/store/renderer/slices/proposal-lifecycle/proposal-lifecycle-types';
import { m } from '$shared/paraglide/messages.js';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface TransferProposalViewProps {
  proposal: WorkspaceTransferProposal;
  source: string;
  destinations: { value: string; label: string }[];
  destinationId?: string;
  onDestinationIdChange?: (value: string) => void;
  entry?: ProposalLifecycleEntry | null;
  disabled?: boolean;
  desktop?: boolean;
  onapprove?: () => void;
  oncancel?: () => void;
}

export function TransferProposalView({
  proposal,
  source,
  destinations,
  destinationId,
  onDestinationIdChange,
  entry,
  disabled = false,
  desktop = true,
  onapprove,
  oncancel,
}: TransferProposalViewProps) {
  const [localDestinationId, setLocalDestinationId] = useState('');
  const destination = destinationId ?? localDestinationId;
  const busy = entry?.status === 'applying';
  const done = entry?.status === 'applied' || entry?.status === 'dismissed';
  const locked = disabled || busy || done;
  const started = Boolean(entry?.result?.transfer);
  const imported = entry?.result?.transfer?.phase === 'imported';
  const project = proposal.preview.fields?.find((field) => field.key === 'workspaceTitle')?.value;
  return (
    <section
      className="min-w-0 w-full overflow-hidden rounded-(--radius-large) border border-border bg-card shadow-(--elevation-raised)"
      data-proposal-kind="workspace-transfer"
      data-lifecycle-status={entry?.status ?? 'idle'}
      data-testid="transfer-proposal"
    >
      <div className="space-y-3 p-5">
        <h3 className="type-body font-medium text-foreground">{proposal.preview.title}</h3>
        {proposal.preview.summary && (
          <p className="type-body text-muted-foreground">{proposal.preview.summary}</p>
        )}
        <dl className="type-body space-y-2">
          <div>
            <dt className="type-caption text-muted-foreground">
              {m.chat_transfer_project_label()}
            </dt>
            <dd className="break-words text-foreground">
              {typeof project === 'string' ? project : proposal.preview.title}
            </dd>
          </div>
          <div>
            <dt className="type-caption text-muted-foreground">{m.chat_transfer_source_label()}</dt>
            <dd className="break-words text-foreground">
              {source}
              <span className="type-caption block text-muted-foreground">
                {proposal.payload.sourceWorkspacePath}
              </span>
            </dd>
          </div>
        </dl>
        <div className="space-y-1">
          <span className="type-caption text-muted-foreground">
            {m.chat_transfer_target_label()}
          </span>
          <Select
            value={destination}
            items={destinations}
            disabled={locked || started}
            onValueChange={(value) => {
              setLocalDestinationId(value);
              onDestinationIdChange?.(value);
            }}
          >
            <SelectTrigger aria-label={m.chat_transfer_target_label()} className="w-full">
              <SelectValue placeholder={m.chat_transfer_choose_label()} />
            </SelectTrigger>
            <SelectContent>
              {destinations.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!destination && (
            <p className="type-caption text-muted-foreground">
              {proposal.payload.destination
                ? m.chat_transfer_hint_description({ destination: proposal.payload.destination })
                : m.chat_transfer_choose_description()}
            </p>
          )}
        </div>
        <p className="type-body text-muted-foreground">{m.chat_transfer_effects_description()}</p>
        {(proposal.preview.warnings ?? []).map((warning, index) => (
          <p key={index} className="type-caption text-muted-foreground">
            {warning}
          </p>
        ))}
        {!desktop && (
          <p className="type-body text-danger" role="alert">
            {m.chat_transfer_desktop_error()}
          </p>
        )}
        {entry?.error && (
          <p className="type-body break-words text-danger" role="alert">
            {entry.error}
          </p>
        )}
        <div aria-live="polite" className="type-body text-muted-foreground">
          {entry?.status === 'applied'
            ? m.chat_transfer_complete_label()
            : entry?.status === 'dismissed'
              ? m.chat_shared_discarded_label()
              : imported
                ? m.chat_transfer_imported_description()
                : busy
                  ? entry?.transferProgress === 'committing'
                    ? m.workspace_transfer_phase_committing()
                    : entry?.transferProgress === 'relaying'
                      ? m.workspace_transfer_phase_relaying()
                      : m.chat_transfer_running_label()
                  : null}
        </div>
      </div>
      {!done && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" disabled={locked || started} onClick={oncancel}>
            {m.workspace_modals_cancel_label()}
          </Button>
          <Button disabled={locked || !desktop || !destination} loading={busy} onClick={onapprove}>
            {imported
              ? m.chat_transfer_finish_label()
              : entry?.status === 'failed'
                ? m.chat_shared_retry_label()
                : m.chat_transfer_approve_label()}
          </Button>
        </div>
      )}
    </section>
  );
}
