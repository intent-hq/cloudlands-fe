<script lang="ts">
  import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Input } from '$lib/components/ui/input';

  let { fixture }: { fixture: UiComponentFixture } = $props();
  let proposedTitle = $state(
    'Use the editorial workspace title while preserving compact behavior across narrow conversation panels',
  );
</script>

<div class="min-w-0" data-catalog-renderer-fixture={fixture.id}>
  {#if fixture.id === 'pending-settings-change'}
    <section
      class="min-w-0 overflow-hidden rounded-(--radius-medium) border border-border bg-card shadow-(--elevation-raised)"
      aria-label="Pending proposal"
    >
      <div class="space-y-1 px-3 pt-3" data-catalog-rendered-state="default">
        <p class="type-caption font-medium uppercase tracking-wide text-muted-foreground">
          Settings change
        </p>
        <h3 class="type-body font-medium text-foreground">Update workspace defaults</h3>
        <p class="type-body leading-relaxed text-muted-foreground">
          Review the suggested title before applying it to this workspace.
        </p>
      </div>
      <div class="px-3 py-3" data-catalog-rendered-state="editable long-content">
        <label
          class="type-caption mb-1 block font-medium text-muted-foreground"
          for="proposal-title"
        >
          Workspace title
        </label>
        <Input id="proposal-title" bind:value={proposedTitle} />
      </div>
      <div class="flex flex-wrap justify-end gap-2 border-t border-border bg-muted/10 px-3 py-3">
        <Button variant="outline" size="sm">Discard</Button>
        <Button size="sm">Apply changes</Button>
      </div>
    </section>
  {:else if fixture.id === 'applied-with-undo'}
    <section
      class="min-w-0 overflow-hidden rounded-(--radius-medium) border border-success/40 bg-card shadow-(--elevation-raised)"
      aria-label="Applied proposal"
      data-catalog-rendered-state="success"
    >
      <div class="space-y-1 px-3 py-3">
        <h3 class="type-body font-medium text-foreground">Theme preset: Editorial light</h3>
        <p class="type-body text-muted-foreground">The requested settings change was applied.</p>
        <div
          class="type-caption rounded-(--radius-small) border border-border bg-background px-3 py-2 text-muted-foreground"
        >
          <span class="font-medium text-foreground">Theme preset</span>: Default → Editorial light
        </div>
      </div>
      <div
        class="type-caption flex flex-wrap items-center justify-between gap-2 border-t border-success/30 bg-success/10 px-3 py-2.5 text-success"
        role="status"
      >
        <span>Applied just now</span>
        <span data-catalog-rendered-state="disabled">
          <Button variant="outline" size="sm" disabled>Undo</Button>
        </span>
      </div>
    </section>
  {:else if fixture.id === 'bulk-operation-warning'}
    <section
      class="min-w-0 overflow-hidden rounded-(--radius-medium) border border-border bg-card shadow-(--elevation-raised)"
      aria-label="Bulk proposal"
    >
      <div class="space-y-1 px-3 pt-3">
        <p class="type-caption font-medium uppercase tracking-wide text-muted-foreground">
          Bulk change
        </p>
        <h3 class="type-body font-medium text-foreground">Update workspace specialists</h3>
        <p
          class="type-body leading-relaxed text-muted-foreground"
          data-catalog-rendered-state="long-content"
        >
          Apply the shared review instructions to selected specialists while leaving locked
          organization defaults unchanged.
        </p>
      </div>
      <div
        class="type-caption mx-3 mt-3 rounded-(--radius-small) border border-warning/40 bg-warning/10 px-3 py-2 text-warning"
        role="note"
        aria-label="Proposal warning"
        data-catalog-rendered-state="warning"
      >
        One specialist is locked and will be skipped.
      </div>
      <div
        class="mx-3 my-3 divide-y divide-border rounded-(--radius-medium) border border-border bg-background"
        data-catalog-rendered-state="mixed-selection"
      >
        <label class="type-body flex min-w-0 items-start gap-3 px-3 py-2.5 text-foreground">
          <Checkbox checked ariaLabel="Toggle Review Buddy" />
          <span class="min-w-0 break-words">Review Buddy</span>
        </label>
        <label class="type-body flex min-w-0 items-start gap-3 px-3 py-2.5 text-foreground">
          <Checkbox ariaLabel="Toggle Test Writer" />
          <span class="min-w-0 break-words">Test Writer</span>
        </label>
        <label class="type-body flex min-w-0 items-start gap-3 px-3 py-2.5 text-muted-foreground">
          <Checkbox checked disabled ariaLabel="Toggle Organization Default" />
          <span class="min-w-0 break-words">Organization Default · Locked</span>
        </label>
      </div>
      <div class="flex flex-wrap justify-end gap-2 border-t border-border bg-muted/10 px-3 py-3">
        <Button variant="outline" size="sm">Discard</Button>
        <Button size="sm">Apply selected</Button>
      </div>
    </section>
  {:else}
    <p class="type-body text-muted-foreground">Unsupported Proposal Card fixture.</p>
  {/if}
</div>
