<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { store as appStore } from '$store/renderer/store';
  import { legacyImportRequested } from '$store/renderer/slices/legacy-import/legacy-import-slice';
  import {
    selectLegacyImportError,
    selectLegacyImportLoading,
    selectLegacyImportReport,
  } from '$store/renderer/slices/legacy-import/legacy-import-selectors';
  import type { LegacyImportReport } from '$store/renderer/slices/legacy-import/legacy-import-types';

  let overwrite = $state(false);
  const loading = selectLegacyImportLoading();
  const report = selectLegacyImportReport();
  const error = selectLegacyImportError();

  function summary(value: LegacyImportReport): string {
    return `${value.imported} imported, ${value.updated} updated, ${value.skipped} skipped · ${value.notes} notes, ${value.comments} comments, ${value.agents} agents, ${value.assets} assets.`;
  }

  function handleImport() {
    appStore.dispatch(legacyImportRequested(overwrite));
  }
</script>

<div class="flex flex-col bg-card rounded-xl divide-y divide-border">
  <section class="px-6 py-5">
    <div class="flex items-center justify-between gap-6">
      <div>
        <p class="text-sm font-medium text-foreground">Legacy workspaces</p>
        <p class="text-xs text-subtle mt-0.5">Import workspaces from a previous Intent install.</p>
      </div>
      <Button size="sm" disabled={$loading} onclick={handleImport}>
        {$loading ? 'Importing…' : 'Import legacy workspaces'}
      </Button>
    </div>

    {#if $report}
      <p class="text-xs text-foreground mt-3" role="status">
        {summary($report)}
        {#if $report.compatibilityFailures}
          Some workspaces could not be imported.
        {/if}
      </p>
    {:else if $error}
      <p
        class="text-xs text-destructive-foreground bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2 mt-3"
        role="alert"
      >
        Import failed: {$error}
      </p>
    {/if}
  </section>

  <section class="px-6 py-4">
    <div class="flex items-center justify-between gap-4">
      <div>
        <p class="text-sm font-medium text-foreground">Overwrite existing</p>
        <p class="text-xs text-subtle mt-0.5">Replace workspaces that were already imported.</p>
      </div>
      <Toggle
        variant="indicator"
        size="xs"
        pressed={overwrite}
        disabled={$loading}
        ariaLabel="Overwrite existing workspaces"
        onLabel="On"
        offLabel="Off"
        onChange={(value) => (overwrite = value === true)}
      />
    </div>
  </section>
</div>
