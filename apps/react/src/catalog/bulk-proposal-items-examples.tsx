// i18n-ignore (internal unreleased component preview controls and sample content)
import { useState } from 'react';
import type { BulkProposalItem } from '$shared/types/proposal';
import { BulkProposalItems } from '@/components/chat/proposals/bulk-proposal-items';
import { Button } from '@/components/ui/button';

const initialItems: BulkProposalItem[] = [
  {
    id: 'rename',
    title: 'Rename workspace',
    summary: 'Give the workspace a clear name before sharing the proposed changes.',
    before: 'Draft',
    after: 'Release review',
  },
  {
    id: 'appearance',
    title: 'Change appearance',
    before: { theme: 'system' },
    after: { theme: 'dark' },
  },
  {
    id: 'history',
    title: 'Keep repository history',
    disabled: true,
    before: true,
    after: true,
  },
];

export function BulkProposalItemsExamples() {
  const [items, setItems] = useState(initialItems);
  const [selectedIds, setSelectedIds] = useState(['rename']);
  const [disabled, setDisabled] = useState(false);
  return (
    <section className="grid min-w-0 w-full max-w-lg gap-4" data-testid="bulk-proposal-demo">
      <h2>Proposal selection</h2>
      <div className="min-w-0" data-testid="bulk-proposal-frame">
        <BulkProposalItems
          items={items}
          selectedIds={selectedIds}
          disabled={disabled}
          onSelectionChange={setSelectedIds}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setSelectedIds(['rename'])}>
          Reset selection
        </Button>
        <Button variant="outline" onClick={() => setItems([...items].reverse())}>
          Reverse rows
        </Button>
        <Button variant="outline" aria-pressed={disabled} onClick={() => setDisabled(!disabled)}>
          Disable selection
        </Button>
      </div>
      <output className="type-caption text-muted-foreground" aria-label="Selected proposal items">
        {selectedIds.join(', ') || 'None'}
      </output>
    </section>
  );
}
