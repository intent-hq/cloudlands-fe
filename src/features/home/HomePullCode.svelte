<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { Button } from '$lib/components/ui/button';
  import HomeSearch from './HomeSearch.svelte';
  import DiffViewer from '$features/file-tracking/components/diff/DiffViewer.svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { HomePullFile } from './home-integrations-types';
  let { files, open }: { files: HomePullFile[]; open: (url: string, event?: MouseEvent) => void } =
    $props();
  let query = $state('');
  let selected = $state<string | null>(null);
  const filtered = $derived(
    files.filter((file) => file.filename.toLowerCase().includes(query.toLowerCase())),
  );
  const active = $derived(filtered.find((file) => file.filename === selected) ?? filtered[0]);
  // REST file patches contain hunks only; the canonical viewer consumes a full
  // unified patch. Quoted paths retain spaces, tabs and renamed filenames.
  function unifiedPatch(file: HomePullFile): string {
    const oldPath = JSON.stringify(`a/${file.previousFilename ?? file.filename}`);
    const newPath = JSON.stringify(`b/${file.filename}`);
    return `diff --git ${oldPath} ${newPath}\n--- ${file.status === 'added' ? '/dev/null' : oldPath}\n+++ ${file.status === 'removed' ? '/dev/null' : newPath}\n${file.patch}\n`;
  }
</script>

<div class="space-y-4" data-home-pr-code>
  <HomeSearch
    placeholder={m.home_integrations_files_search()}
    value={query}
    onchange={(value) => (query = value)}
  />
  <div
    class="max-h-52 overflow-y-auto rounded-lg border border-border"
    aria-label={m.home_integrations_code_tab()}
  >
    {#each filtered as file (file.filename)}
      <Button
        variant="ghost"
        class="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left type-caption last:border-0 hover:bg-muted/50 {active?.filename ===
        file.filename
          ? 'bg-muted'
          : ''}"
        aria-pressed={active?.filename === file.filename}
        onclick={() => (selected = file.filename)}
      >
        <Tooltip.Provider
          ><Tooltip.Root
            ><Tooltip.Trigger
              >{#snippet child({ props: homeTooltipProps })}<span
                  {...homeTooltipProps}
                  class="min-w-0 flex-1 truncate font-mono">{file.filename}</span
                >{/snippet}</Tooltip.Trigger
            ><Tooltip.Content>{file.filename}</Tooltip.Content></Tooltip.Root
          ></Tooltip.Provider
        >
        <span class="shrink-0 text-success">+{formatInteger(file.additions)}</span><span
          class="shrink-0 text-danger">−{formatInteger(file.deletions)}</span
        >
      </Button>
    {/each}
    {#if !filtered.length}<p class="p-4 type-caption text-muted-foreground">
        {m.home_integrations_no_files()}
      </p>{/if}
  </div>
  {#if active}
    <div class="space-y-3 min-w-0">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="break-all font-mono type-caption">{active.filename}</span>
        {#if active.url}<Button
            size="sm"
            variant="ghost"
            onclick={(event) => open(active.url!, event)}>{m.home_integrations_open_file()}</Button
          >{/if}
      </div>
      {#key active.filename}
        {#if active.patch}<DiffViewer
            patch={unifiedPatch(active)}
            fileName={active.filename}
            oldFileName={active.previousFilename ?? undefined}
            viewMode="unified"
            showHeader={false}
            maxHeight="640px"
          />
        {:else}<p class="rounded-lg bg-muted/40 p-4 type-caption text-muted-foreground">
            {m.home_integrations_patch_unavailable()}
          </p>{/if}
      {/key}
    </div>
  {/if}
</div>
