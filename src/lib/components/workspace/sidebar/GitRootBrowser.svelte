<script lang="ts">
  /**
   * GitRootBrowser - Changes tab git-root dropdown + read-only per-root
   * browsing (multi git root tracking, monorepo#2053).
   *
   * Renders nothing when the workspace tracks no secondary roots. With
   * secondary roots, shows the root dropdown (first entry = the synthesized
   * primary workspace root) and, when a secondary root is selected, the
   * read-only SecondaryRootChangesView. The parent hides its primary-root
   * body while `onBrowsingSecondaryChange(true)` is in effect; primary
   * selection restores today's behavior exactly.
   */
  import { writable } from 'svelte/store';
  import { untrack } from 'svelte';
  import {
    selectHasSecondaryGitRoots,
    selectWorkspaceGitRootEntries,
  } from '$store/renderer/slices/git-roots/git-roots-selectors';
  import { Select } from '$lib/components/ui/select';
  import SecondaryRootChangesView from './SecondaryRootChangesView.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    workspaceId: string;
    /** Notifies the parent when secondary-root browsing starts/stops so it
     * can hide/show the primary changes body. */
    onBrowsingSecondaryChange?: (browsing: boolean) => void;
  }

  let { workspaceId, onBrowsingSecondaryChange }: Props = $props();

  const workspaceIdStore = writable(workspaceId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  const hasSecondaryGitRoots$ = selectHasSecondaryGitRoots(workspaceIdStore);
  const gitRootEntries$ = selectWorkspaceGitRootEntries(workspaceIdStore);

  let selectedRootKey = $state('primary');

  const selectedRootEntry = $derived(
    ($gitRootEntries$ ?? []).find((e) => e.key === selectedRootKey),
  );
  const isSecondaryRootSelected = $derived(
    selectedRootKey !== 'primary' && !!selectedRootEntry && !selectedRootEntry.isPrimary,
  );

  // Reset to the primary root on workspace switch, and fall back to it when
  // the selected root disappears (unregistered / auto-pruned).
  let lastWorkspaceId: string | null = null;
  $effect(() => {
    const wsId = workspaceId;
    const entries = $gitRootEntries$ ?? [];
    untrack(() => {
      if (lastWorkspaceId !== wsId) {
        lastWorkspaceId = wsId;
        selectedRootKey = 'primary';
        return;
      }
      if (selectedRootKey !== 'primary' && !entries.some((e) => e.key === selectedRootKey)) {
        selectedRootKey = 'primary';
      }
    });
  });

  // Report browsing state to the parent
  $effect(() => {
    const browsing = isSecondaryRootSelected;
    untrack(() => onBrowsingSecondaryChange?.(browsing));
  });

  /** Compact display label for a root entry: trailing path segment(s). */
  function rootDisplayLabel(entry: { isPrimary: boolean; path?: string }): string {
    if (entry.isPrimary) return m.workspace_sidebarChanges_rootPrimary_label();
    if (!entry.path) return m.workspace_branchDisplay_noBranch_label();
    const segments = entry.path.split(/[/\\]/).filter(Boolean);
    return segments.slice(-2).join('/') || entry.path;
  }
</script>

{#if $hasSecondaryGitRoots$}
  <div class="mb-2 mt-1" data-testid="git-root-selector">
    <Select.Root value={selectedRootKey} onchange={(value) => (selectedRootKey = value)}>
      <Select.Trigger
        class="py-1 h-7 text-ui"
        aria-label={m.workspace_sidebarChanges_rootSelector_ariaLabel()}
      >
        <span class="truncate">
          {selectedRootEntry
            ? rootDisplayLabel(selectedRootEntry)
            : m.workspace_sidebarChanges_rootPrimary_label()}
        </span>
      </Select.Trigger>
      <Select.Content portal class="max-h-[300px]">
        {#each $gitRootEntries$ ?? [] as entry (entry.key)}
          <Select.Item value={entry.key} label={rootDisplayLabel(entry)}>
            <span class="truncate">{rootDisplayLabel(entry)}</span>
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  {#if isSecondaryRootSelected && selectedRootEntry}
    <!-- Read-only per-root browsing; the workspace-scoped PR sections and all
         mutation affordances stay on the primary root view. -->
    <SecondaryRootChangesView {workspaceId} entry={selectedRootEntry} />
  {/if}
{/if}
