// i18n-ignore (internal unreleased component preview controls and sample content)
import { useState } from 'react';
import type { WorkspaceTransferProposal } from '$shared/types/proposal';
import type { ProposalLifecycleEntry } from '../../../../src/store/renderer/slices/proposal-lifecycle/proposal-lifecycle-types';
import { TransferProposalView } from '@/components/chat/proposals/transfer-proposal-view';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const proposal: WorkspaceTransferProposal = {
  kind: 'workspace-transfer',
  payload: {
    operation: 'workspace.transfer',
    workspaceId: 'preview-workspace',
    sourceWorkspacePath: '/projects/release-review',
  },
  preview: {
    title: 'Move release review',
    summary: 'Continue this workspace on another connected computer.',
    fields: [{ key: 'workspaceTitle', label: 'Workspace', value: 'Release review' }],
  },
};
const destinations = [
  { value: 'laptop', label: 'Development laptop' },
  { value: 'desktop', label: 'Office desktop' },
];
const states = ['idle', 'applying', 'imported', 'failed', 'applied', 'dismissed'] as const;
type PreviewState = (typeof states)[number];

function previewEntry(state: PreviewState): ProposalLifecycleEntry {
  if (state === 'imported') {
    return {
      status: 'failed',
      result: {
        transfer: {
          workspaceId: 'preview-workspace',
          sourceWorkspacePath: proposal.payload.sourceWorkspacePath,
          sourceConnectionId: 'source',
          destinationConnectionId: 'desktop',
          phase: 'imported',
        },
      },
    };
  }
  return {
    status: state,
    ...(state === 'applying' ? { transferProgress: 'relaying' } : {}),
    ...(state === 'failed'
      ? { error: 'The destination disconnected. Try again when it reconnects.' }
      : {}),
  };
}

export function TransferProposalExamples() {
  const [destinationId, setDestinationId] = useState('');
  const [state, setState] = useState<PreviewState>('idle');
  const [desktop, setDesktop] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [calls, setCalls] = useState<string[]>([]);
  return (
    <section className="grid min-w-0 w-full max-w-lg gap-4" data-testid="transfer-proposal-demo">
      <h2>Transfer proposal</h2>
      <div className="min-w-0" data-testid="transfer-proposal-frame">
        <TransferProposalView
          proposal={proposal}
          source="Current computer"
          destinations={destinations}
          destinationId={destinationId}
          onDestinationIdChange={setDestinationId}
          entry={previewEntry(state)}
          desktop={desktop}
          disabled={disabled}
          onapprove={() => setCalls([...calls, `approve:${destinationId}`])}
          oncancel={() => setCalls([...calls, 'cancel'])}
        />
      </div>
      <Select
        value={state}
        items={states.map((value) => ({ value, label: value }))}
        onValueChange={(value) => setState(value as PreviewState)}
      >
        <SelectTrigger aria-label="Preview transfer state">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {states.map((value) => (
            <SelectItem key={value} value={value}>
              {value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setDestinationId('desktop')}>
          Use office desktop
        </Button>
        <Button variant="outline" aria-pressed={!desktop} onClick={() => setDesktop(!desktop)}>
          Non-desktop mode
        </Button>
        <Button variant="outline" aria-pressed={disabled} onClick={() => setDisabled(!disabled)}>
          Disable actions
        </Button>
      </div>
      <output
        aria-label="Transfer preview callbacks"
        className="type-caption min-w-0 break-words text-muted-foreground"
      >
        {JSON.stringify(calls)}
      </output>
    </section>
  );
}
