<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { openExternalUrl } from '$lib/utils/open-external';
  import type { OpenPrWarningItem } from '$lib/utils/delete-warning-utils';
  import type {
    LocalChangesRoot,
    LocalChangesWarning,
  } from '$store/renderer/slices/workspace-operations/workspace-operations-types';

  interface Props {
    open?: boolean;
    /** 'delete' (default) warns before a permanent delete; 'archive' before an archive. */
    mode?: 'delete' | 'archive';
    agentNames?: string[];
    hookNames?: string[];
    openPrs?: OpenPrWarningItem[];
    /** `workspace.localChanges` result; null when unavailable (fail-open). */
    localChanges?: LocalChangesWarning | null;
    onDeleteAnyway?: () => void;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    mode = 'delete',
    agentNames = [],
    hookNames = [],
    openPrs = [],
    localChanges = null,
    onDeleteAnyway,
    onCancel,
  }: Props = $props();

  const isArchive = $derived(mode === 'archive');
  const hasLocalChanges = $derived(
    localChanges != null && (localChanges.hasUnpushedCommits || localChanges.hasUncommittedChanges),
  );
  // Roots with local work; rows the daemon could not read carry `error` and are skipped.
  const localChangeRoots = $derived(
    hasLocalChanges
      ? (localChanges?.roots ?? []).filter(
          (root) => !root.error && (root.unpushedCount > 0 || root.uncommittedCount > 0),
        )
      : [],
  );

  function rootBranchLabel(root: LocalChangesRoot): string {
    return root.branch || m.workspace_branchDisplay_noBranch_label();
  }

  function rootLabel(root: LocalChangesRoot): string {
    if (root.kind === 'primary') return rootBranchLabel(root);
    const name = root.path.split(/[/\\]/).filter(Boolean).pop() || root.path;
    return m.modals_deleteWarning_localChanges_secondaryRoot_label({
      name,
      branch: rootBranchLabel(root),
    });
  }
  const closeAriaLabel = $derived(
    isArchive
      ? m.modals_archiveWarning_close_ariaLabel()
      : m.modals_deleteWarning_close_ariaLabel(),
  );

  function close() {
    open = false;
    onCancel?.();
  }

  function handleDeleteAnyway() {
    onDeleteAnyway?.();
    open = false;
  }

  function handlePrLinkClick(event: MouseEvent, url: string) {
    event.preventDefault();
    // eslint-disable-next-line intent/no-component-async-data-fetch -- opens an external URL in the system browser, not a domain data fetch
    void openExternalUrl(url);
  }

  let confirmButtonRef: HTMLButtonElement | null = $state(null);
  let confirmHasFocus = $state(false);

  function handleOpenAutoFocus(event: Event) {
    event.preventDefault();
    confirmButtonRef?.focus();
  }
</script>

<Dialog.Root {open} onOpenChange={(nextOpen) => !nextOpen && close()}>
  <Dialog.Content
    class="max-w-md gap-0 overflow-hidden p-0"
    closeLabel={closeAriaLabel}
    onOpenAutoFocus={handleOpenAutoFocus}
  >
    <div class="space-y-4 p-5 pr-12">
      <Dialog.Header class="gap-2 pr-0">
        <Dialog.Title>
          {isArchive ? m.modals_archiveWarning_title() : m.modals_deleteWarning_title()}
        </Dialog.Title>
        <Dialog.Description class="leading-5">
          {isArchive ? m.modals_archiveWarning_description() : m.modals_deleteWarning_description()}
        </Dialog.Description>
      </Dialog.Header>

      {#if agentNames.length > 0 || hookNames.length > 0 || openPrs.length > 0 || hasLocalChanges}
        <div class="rounded-md border border-border bg-muted/40 p-3">
          {#if agentNames.length > 0}
            <p class="text-sm font-medium text-foreground">
              {agentNames.length === 1
                ? m.modals_deleteWarning_agentsStopped_one({
                    count: formatInteger(agentNames.length),
                  })
                : m.modals_deleteWarning_agentsStopped_many({
                    count: formatInteger(agentNames.length),
                  })}
            </p>
            <ul class="mt-2 max-h-28 space-y-1 overflow-auto pr-1">
              {#each agentNames as name}
                <li class="truncate text-sm text-subtle">{name}</li>
              {/each}
            </ul>
          {/if}
          {#if hookNames.length > 0}
            <p class="text-sm font-medium text-foreground" class:mt-3={agentNames.length > 0}>
              {hookNames.length === 1
                ? m.modals_deleteWarning_hooksCancelled_one({
                    count: formatInteger(hookNames.length),
                  })
                : m.modals_deleteWarning_hooksCancelled_many({
                    count: formatInteger(hookNames.length),
                  })}
            </p>
            <ul class="mt-2 max-h-28 space-y-1 overflow-auto pr-1">
              {#each hookNames as name}
                <li class="truncate text-sm text-subtle">{name}</li>
              {/each}
            </ul>
          {/if}
          {#if openPrs.length > 0}
            <p
              class="text-sm font-medium text-foreground"
              class:mt-3={agentNames.length > 0 || hookNames.length > 0}
            >
              {openPrs.length === 1
                ? m.modals_deleteWarning_openPrs_one({
                    count: formatInteger(openPrs.length),
                  })
                : m.modals_deleteWarning_openPrs_many({
                    count: formatInteger(openPrs.length),
                  })}
            </p>
            <ul class="mt-2 max-h-28 space-y-1 overflow-auto pr-1">
              {#each openPrs as pr (pr.url || pr.number)}
                <li class="flex items-center gap-2 text-sm text-subtle">
                  {#if pr.url}
                    <a
                      href={pr.url}
                      class="min-w-0 truncate text-primary hover:underline"
                      onclick={(event) => handlePrLinkClick(event, pr.url)}
                    >
                      #{pr.number}
                      {pr.title}
                    </a>
                  {:else}
                    <span class="min-w-0 truncate">#{pr.number} {pr.title}</span>
                  {/if}
                  <Badge variant={pr.status === 'Draft' ? 'secondary' : 'success'}>
                    {pr.status === 'Draft'
                      ? m.workspace_prSection_statusDraft_label()
                      : m.workspace_prSection_statusOpen_label()}
                  </Badge>
                  {#if pr.mergeConflicts === true}
                    <Badge variant="destructive">
                      {m.modals_deleteWarning_prMergeConflicts_label()}
                    </Badge>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
          {#if hasLocalChanges}
            <p
              class="text-sm font-medium text-foreground"
              class:mt-3={agentNames.length > 0 || hookNames.length > 0 || openPrs.length > 0}
            >
              {isArchive
                ? m.modals_archiveWarning_localChanges_description()
                : m.modals_deleteWarning_localChanges_description()}
            </p>
            <ul class="mt-2 max-h-28 space-y-1 overflow-auto pr-1">
              {#each localChangeRoots as root (root.gitRootId ?? root.path)}
                <li class="flex items-center gap-2 text-sm text-subtle">
                  <span class="min-w-0 truncate">{rootLabel(root)}</span>
                  {#if root.unpushedCount > 0}
                    <Badge variant="secondary" class="shrink-0">
                      {root.unpushedCount === 1
                        ? m.modals_deleteWarning_localChanges_unpushed_one({
                            count: formatInteger(root.unpushedCount),
                          })
                        : m.modals_deleteWarning_localChanges_unpushed_many({
                            count: formatInteger(root.unpushedCount),
                          })}
                    </Badge>
                  {/if}
                  {#if root.uncommittedCount > 0}
                    <Badge variant="secondary" class="shrink-0">
                      {m.modals_deleteWarning_localChanges_uncommitted_label()}
                    </Badge>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      <p class="text-sm leading-5 text-subtle">
        {isArchive
          ? m.modals_archiveWarning_note_description()
          : m.modals_deleteWarning_permanent_description()}
      </p>
    </div>

    <Dialog.Footer class="mt-0 flex-row items-center justify-end border-0 px-5 pb-5 pt-0">
      <Button variant="ghost-light" onclick={close}>{m.modals_deleteWarning_cancel_label()}</Button>
      <Button
        variant="destructive"
        bind:ref={confirmButtonRef}
        class={confirmHasFocus ? 'ring-ring/50 ring-[3px]' : undefined}
        onfocus={() => (confirmHasFocus = true)}
        onblur={() => (confirmHasFocus = false)}
        onclick={handleDeleteAnyway}
      >
        {isArchive
          ? m.modals_archiveWarning_confirm_label()
          : m.modals_deleteWarning_confirm_label()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
