<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import { m } from '$shared/paraglide/messages.js';
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
    return m.settings_legacyImport_summary_label({
      imported: value.imported,
      updated: value.updated,
      skipped: value.skipped,
      notes: value.notes,
      comments: value.comments,
      agents: value.agents,
      assets: value.assets,
    });
  }

  function handleImport() {
    appStore.dispatch(legacyImportRequested(overwrite));
  }
</script>

<div class="flex flex-col bg-card rounded-xl divide-y divide-border">
  <section class="px-6 py-5">
    <div class="flex items-center justify-between gap-6">
      <div>
        <p class="text-sm font-medium text-foreground">{m.settings_legacyImport_title_label()}</p>
        <p class="text-xs text-subtle mt-0.5">{m.settings_legacyImport_description()}</p>
      </div>
      <Button size="sm" disabled={$loading} onclick={handleImport}>
        {$loading ? m.settings_legacyImport_importing_label() : m.settings_legacyImport_import_label()}
      </Button>
    </div>

    {#if $report}
      <p class="text-xs text-foreground mt-3" role="status">
        {summary($report)}
        {#if $report.compatibilityFailures}
          {m.settings_legacyImport_compatFailures_label()}
        {/if}
      </p>
    {:else if $error}
      <p
        class="text-xs text-destructive-foreground bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2 mt-3"
        role="alert"
      >
        {m.settings_legacyImport_importFailed_error({ error: $error })}
      </p>
    {/if}
  </section>

  <section class="px-6 py-4">
    <div class="flex items-center justify-between gap-4">
      <div>
        <p class="text-sm font-medium text-foreground">
          {m.settings_legacyImport_overwrite_label()}
        </p>
        <p class="text-xs text-subtle mt-0.5">{m.settings_legacyImport_overwrite_description()}</p>
      </div>
      <Toggle
        variant="indicator"
        size="xs"
        pressed={overwrite}
        disabled={$loading}
        ariaLabel={m.settings_legacyImport_overwrite_ariaLabel()}
        onLabel={m.settings_legacyImport_on_label()}
        offLabel={m.settings_legacyImport_off_label()}
        onChange={(value) => (overwrite = value === true)}
      />
    </div>
  </section>
</div>
