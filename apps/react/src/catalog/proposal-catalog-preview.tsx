// Source: src/lib/component-catalog/renderers/ProposalCatalogPreview.svelte.
// Static visual scaffolding, not the production proposal implementation.
// Apply/Discard have no source handlers; only the input and checkboxes edit local state.
// i18n-ignore (exact source catalog fixture content)
import { useId, useState } from 'react';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

export function ProposalCatalogPreview({ fixture }: { fixture: UiComponentFixture }) {
  const checkboxId = useId();
  const [proposedTitle, setProposedTitle] = useState(
    'Use the editorial workspace title while preserving compact behavior across narrow conversation panels',
  );

  return (
    <div className="min-w-0" data-catalog-renderer-fixture={fixture.id}>
      {fixture.id === 'pending-settings-change' ? (
        <section
          className="min-w-0 overflow-hidden rounded-(--radius-medium) border border-border bg-card shadow-(--elevation-raised)"
          aria-label="Pending proposal"
        >
          <div className="space-y-1 px-3 pt-3" data-catalog-rendered-state="default">
            <p className="type-caption font-medium text-muted-foreground">Settings change</p>
            <h3 className="type-body font-medium text-foreground">Update workspace defaults</h3>
            <p className="type-body leading-relaxed text-muted-foreground">
              Review the suggested title before applying it to this workspace.
            </p>
          </div>
          <div className="px-3 py-3" data-catalog-rendered-state="editable long-content">
            <label
              className="type-caption mb-1 block font-medium text-muted-foreground"
              htmlFor="proposal-title"
            >
              Workspace title
            </label>
            <Input
              id="proposal-title"
              value={proposedTitle}
              onChange={(event) => setProposedTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-muted/10 px-3 py-3">
            <Button variant="outline" size="sm">
              Discard
            </Button>
            <Button size="sm">Apply changes</Button>
          </div>
        </section>
      ) : fixture.id === 'applied-with-undo' ? (
        <section
          className="min-w-0 overflow-hidden rounded-(--radius-medium) border border-success/40 bg-card shadow-(--elevation-raised)"
          aria-label="Applied proposal"
          data-catalog-rendered-state="success"
        >
          <div className="space-y-1 px-3 py-3">
            <h3 className="type-body font-medium text-foreground">Theme preset: Editorial light</h3>
            <p className="type-body text-muted-foreground">
              The requested settings change was applied.
            </p>
            <div className="type-caption rounded-(--radius-small) border border-border bg-background px-3 py-2 text-muted-foreground">
              <span className="font-medium text-foreground">Theme preset</span>: Default → Editorial
              light
            </div>
          </div>
          <output className="type-caption flex flex-wrap items-center justify-between gap-2 border-t border-success/30 bg-success/10 px-3 py-2.5 text-success">
            <span>Applied just now</span>
            <span data-catalog-rendered-state="disabled">
              <Button variant="outline" size="sm" disabled>
                Undo
              </Button>
            </span>
          </output>
        </section>
      ) : fixture.id === 'bulk-operation-warning' ? (
        <section
          className="min-w-0 overflow-hidden rounded-(--radius-medium) border border-border bg-card shadow-(--elevation-raised)"
          aria-label="Bulk proposal"
        >
          <div className="space-y-1 px-3 pt-3">
            <p className="type-caption text-muted-foreground">Bulk change</p>
            <h3 className="type-body font-medium text-foreground">Update workspace specialists</h3>
            <p
              className="type-caption leading-relaxed text-muted-foreground"
              data-catalog-rendered-state="long-content"
            >
              Apply the shared review instructions to selected specialists while leaving locked
              organization defaults unchanged.
            </p>
          </div>
          <div
            className="type-caption mx-3 mt-3 rounded-(--radius-small) bg-warning/10 px-3 py-2 text-warning-ink"
            role="note"
            aria-label="Proposal warning"
            data-catalog-rendered-state="warning"
          >
            One specialist is locked and will be skipped.
          </div>
          <div
            className="mx-3 my-3 divide-y divide-border"
            data-catalog-rendered-state="mixed-selection"
          >
            <label
              className="type-body flex min-w-0 items-start gap-3 py-2.5 text-foreground"
              htmlFor={`${checkboxId}-review`}
            >
              <Checkbox
                id={`${checkboxId}-review`}
                defaultChecked
                ariaLabel="Toggle Review Buddy"
              />
              <span className="min-w-0 break-words">Review Buddy</span>
            </label>
            <label
              className="type-body flex min-w-0 items-start gap-3 py-2.5 text-foreground"
              htmlFor={`${checkboxId}-test`}
            >
              <Checkbox id={`${checkboxId}-test`} ariaLabel="Toggle Test Writer" />
              <span className="min-w-0 break-words">Test Writer</span>
            </label>
            <label
              className="type-body flex min-w-0 items-start gap-3 py-2.5 text-muted-foreground"
              htmlFor={`${checkboxId}-organization`}
            >
              <Checkbox
                id={`${checkboxId}-organization`}
                defaultChecked
                disabled
                ariaLabel="Toggle Organization Default"
              />
              <span className="min-w-0 break-words">Organization Default · Locked</span>
            </label>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-3 py-3">
            <Button variant="outline" size="sm">
              Discard
            </Button>
            <Button size="sm">Apply selected</Button>
          </div>
        </section>
      ) : (
        <p className="type-body text-muted-foreground">Unsupported Proposal Card fixture.</p>
      )}
    </div>
  );
}
