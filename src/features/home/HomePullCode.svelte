<script lang="ts">
  import * as Accordion from '$lib/components/ui/accordion';
  import { Button } from '$lib/components/ui/button';
  import HomeSearch from './HomeSearch.svelte';
  import DiffViewer from '$features/file-tracking/components/diff/DiffViewer.svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { HomePullFile } from './home-integrations-types';
  let { files, open }: { files: HomePullFile[]; open: (url: string, event?: MouseEvent) => void } =
    $props();
  let query = $state('');
  let expandedFiles = $state<string[]>([]);
  const filtered = $derived(
    files.filter((file) => file.filename.toLowerCase().includes(query.toLowerCase())),
  );
  // REST file patches contain hunks only; the canonical viewer consumes a full
  // unified patch. Quoted paths retain spaces, tabs and renamed filenames.
  function unifiedPatch(file: HomePullFile): string {
    const oldPath = JSON.stringify(`a/${file.previousFilename ?? file.filename}`);
    const newPath = JSON.stringify(`b/${file.filename}`);
    return `diff --git ${oldPath} ${newPath}\n--- ${file.status === 'added' ? '/dev/null' : oldPath}\n+++ ${file.status === 'removed' ? '/dev/null' : newPath}\n${file.patch}\n`;
  }
</script>

<div class="min-w-0 space-y-3" data-home-pr-code>
  <HomeSearch
    placeholder={m.home_integrations_files_search()}
    value={query}
    onchange={(value) => (query = value)}
  />
  <Accordion.Root
    type="multiple"
    bind:value={expandedFiles}
    class="min-w-0 space-y-1"
    aria-label={m.home_integrations_code_tab()}
  >
    {#each filtered as file (file.filename)}
      {@const separator = file.filename.lastIndexOf('/')}
      {@const filename = file.filename.slice(separator + 1)}
      {@const directory = separator < 0 ? '' : file.filename.slice(0, separator)}
      <Accordion.Item class="min-w-0" value={file.filename} data-home-pr-file={file.filename}>
        <Accordion.Header>
          <Accordion.Trigger
            class="items-start type-body font-normal! text-foreground"
            aria-label={file.filename}
            data-home-pr-file-toggle
          >
            <span class="flex min-w-0 items-start gap-2">
              <span class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span class="min-w-0 break-all text-foreground" data-home-pr-file-name>
                  {filename}
                </span>
                {#if directory}
                  <span class="min-w-0 break-all text-muted-foreground" data-home-pr-file-path>
                    {directory}
                  </span>
                {/if}
              </span>
              {#if file.additions || file.deletions}
                <span class="flex shrink-0 items-baseline gap-2 tabular-nums">
                  {#if file.additions}<span class="text-success"
                      >+{formatInteger(file.additions)}</span
                    >{/if}
                  {#if file.deletions}<span class="text-danger"
                      >−{formatInteger(file.deletions)}</span
                    >{/if}
                </span>
              {/if}
            </span>
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content inset={false}>
          {#if expandedFiles.includes(file.filename)}
            <div class="min-w-0 space-y-2 pb-3 pt-1" data-home-pr-file-diff>
              {#if file.url}
                <div class="flex justify-end">
                  <Button size="sm" variant="ghost" onclick={(event) => open(file.url!, event)}>
                    {m.home_integrations_open_file()}
                  </Button>
                </div>
              {/if}
              {#if file.patch}
                <DiffViewer
                  patch={unifiedPatch(file)}
                  fileName={file.filename}
                  oldFileName={file.previousFilename ?? undefined}
                  viewMode="unified"
                  showHeader={false}
                />
              {:else}
                <p class="rounded-lg bg-muted/40 p-4 type-body text-muted-foreground">
                  {m.home_integrations_patch_unavailable()}
                </p>
              {/if}
            </div>
          {/if}
        </Accordion.Content>
      </Accordion.Item>
    {/each}
    {#if !filtered.length}
      <p class="p-4 type-body text-muted-foreground">{m.home_integrations_no_files()}</p>
    {/if}
  </Accordion.Root>
</div>
