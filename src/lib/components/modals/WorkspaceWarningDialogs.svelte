<script lang="ts">
  import BulkActionConfirmDialog from './BulkActionConfirmDialog.svelte';
  import BulkWorkspaceList from './BulkWorkspaceList.svelte';
  import { untrack } from 'svelte';
  import { readable } from 'svelte/store';
  import type { ComponentProps } from 'svelte';
  import DeleteWarningDialog from './DeleteWarningDialog.svelte';
  import RetireWorkspaceConfirmDialog from './RetireWorkspaceConfirmDialog.svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    closeBulkArchiveConfirm,
    closeBulkDeleteConfirm,
    closeBulkRetireConfirm,
    closeArchiveWarning,
    closeDeleteWarning,
    confirmBulkArchive,
    confirmBulkDelete,
    confirmBulkRetire,
    confirmArchiveWorkspace,
    confirmDeleteWorkspace,
    closeRetireConfirm,
    confirmRetireWorkspace,
  } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
  import {
    selectActiveHookNamesForArchive,
    selectActiveHookNamesForDelete,
    selectBulkActiveAgentCount,
    selectBulkActiveHookCount,
    selectBulkGuestCount,
    selectBulkOpenPrCount,
    selectBulkPreflightReady,
    selectGuestsForArchive,
    selectGuestsForDelete,
    selectLocalChangesForDelete,
    selectOpenPrsForArchive,
    selectOpenPrsForDelete,
    selectPendingBulkGroupLabel,
    selectPendingBulkWorkspaces,
    selectRunningAgentsForArchive,
    selectRunningAgentsForDelete,
    selectShowArchiveWarning,
    selectShowBulkArchiveConfirm,
    selectShowBulkDeleteConfirm,
    selectShowBulkRetireConfirm,
    selectShowDeleteWarning,
    selectPendingRetireWorkspaceTitle,
    selectShowRetireConfirm,
  } from '$store/renderer/slices/workspace-operations/workspace-operations-selectors';

  let { staticData }: { staticData?: ComponentProps<typeof DeleteWarningDialog> } = $props();

  const showDeleteWarning$ = untrack(() =>
    staticData ? readable(undefined) : selectShowDeleteWarning(),
  );
  const runningAgentsForDelete$ = untrack(() =>
    staticData ? readable(undefined) : selectRunningAgentsForDelete(),
  );
  const activeHookNamesForDelete$ = untrack(() =>
    staticData ? readable(undefined) : selectActiveHookNamesForDelete(),
  );
  const openPrsForDelete$ = untrack(() =>
    staticData ? readable(undefined) : selectOpenPrsForDelete(),
  );
  const localChangesForDelete$ = untrack(() =>
    staticData ? readable(undefined) : selectLocalChangesForDelete(),
  );
  const guestsForDelete$ = untrack(() =>
    staticData ? readable(undefined) : selectGuestsForDelete(),
  );
  const showArchiveWarning$ = untrack(() =>
    staticData ? readable(undefined) : selectShowArchiveWarning(),
  );
  const runningAgentsForArchive$ = untrack(() =>
    staticData ? readable(undefined) : selectRunningAgentsForArchive(),
  );
  const activeHookNamesForArchive$ = untrack(() =>
    staticData ? readable(undefined) : selectActiveHookNamesForArchive(),
  );
  const openPrsForArchive$ = untrack(() =>
    staticData ? readable(undefined) : selectOpenPrsForArchive(),
  );
  const showBulkArchiveConfirm$ = untrack(() =>
    staticData ? readable(undefined) : selectShowBulkArchiveConfirm(),
  );
  const showBulkDeleteConfirm$ = untrack(() =>
    staticData ? readable(undefined) : selectShowBulkDeleteConfirm(),
  );
  const showBulkRetireConfirm$ = untrack(() =>
    staticData ? readable(false) : selectShowBulkRetireConfirm(),
  );
  const pendingBulkWorkspaces$ = untrack(() =>
    staticData ? readable([]) : selectPendingBulkWorkspaces(),
  );
  const pendingBulkGroupLabel$ = untrack(() =>
    staticData ? readable(undefined) : selectPendingBulkGroupLabel(),
  );
  const bulkActiveAgentCount$ = untrack(() =>
    staticData ? readable(undefined) : selectBulkActiveAgentCount(),
  );
  const bulkActiveHookCount$ = untrack(() =>
    staticData ? readable(undefined) : selectBulkActiveHookCount(),
  );
  const bulkOpenPrCount$ = untrack(() =>
    staticData ? readable(undefined) : selectBulkOpenPrCount(),
  );
  const bulkPreflightReady$ = untrack(() =>
    staticData ? readable(undefined) : selectBulkPreflightReady(),
  );
  const bulkGuestCount$ = untrack(() =>
    staticData ? readable(undefined) : selectBulkGuestCount(),
  );
  const guestsForArchive$ = untrack(() =>
    staticData ? readable(undefined) : selectGuestsForArchive(),
  );
  const showRetireConfirm$ = untrack(() =>
    staticData ? readable(false) : selectShowRetireConfirm(),
  );
  const pendingRetireWorkspaceTitle$ = untrack(() =>
    staticData ? readable('') : selectPendingRetireWorkspaceTitle(),
  );

  const bulkCount = $derived(formatInteger($pendingBulkWorkspaces$.length));
  const bulkOne = $derived($pendingBulkWorkspaces$.length === 1);
  // A group action names its group; a Home selection is titled by its count.
  const bulkArchiveTitle = $derived(
    $pendingBulkGroupLabel$
      ? m.modals_bulkArchive_title({ group: $pendingBulkGroupLabel$ })
      : bulkOne
        ? m.modals_bulkArchive_selectionTitle_one({ count: bulkCount })
        : m.modals_bulkArchive_selectionTitle_many({ count: bulkCount }),
  );
  const bulkDeleteTitle = $derived(
    $pendingBulkGroupLabel$
      ? m.modals_bulkDelete_title({ group: $pendingBulkGroupLabel$ })
      : bulkOne
        ? m.modals_bulkDelete_selectionTitle_one({ count: bulkCount })
        : m.modals_bulkDelete_selectionTitle_many({ count: bulkCount }),
  );
</script>

{#if staticData}
  <DeleteWarningDialog {...staticData} static />
{:else}
  <!-- Redux-owned delete warning host (global for all workspace delete entrypoints) -->
  <DeleteWarningDialog
    open={$showDeleteWarning$}
    agents={$runningAgentsForDelete$}
    hookNames={$activeHookNamesForDelete$}
    openPrs={$openPrsForDelete$}
    localChanges={$localChangesForDelete$}
    guests={$guestsForDelete$}
    onDeleteAnyway={() => appStore.dispatch(confirmDeleteWorkspace())}
    onCancel={() => appStore.dispatch(closeDeleteWarning())}
  />

  <!-- Redux-owned archive warning host (global for all workspace archive entrypoints) -->
  <DeleteWarningDialog
    open={$showArchiveWarning$}
    mode="archive"
    agents={$runningAgentsForArchive$}
    hookNames={$activeHookNamesForArchive$}
    openPrs={$openPrsForArchive$}
    guests={$guestsForArchive$}
    onDeleteAnyway={() => appStore.dispatch(confirmArchiveWorkspace())}
    onCancel={() => appStore.dispatch(closeArchiveWarning())}
  />

  <!-- Redux-owned retire confirmation (PROTOCOL §5.1 Retired workspaces) -->
  <RetireWorkspaceConfirmDialog
    open={$showRetireConfirm$}
    workspaceTitle={$pendingRetireWorkspaceTitle$ || m.workspace_ops_space_fallback()}
    onConfirm={() => appStore.dispatch(confirmRetireWorkspace())}
    onCancel={() => appStore.dispatch(closeRetireConfirm())}
  />
  <BulkActionConfirmDialog
    open={$showBulkArchiveConfirm$}
    mode="archive"
    title={bulkArchiveTitle}
    description={$pendingBulkWorkspaces$.length === 1
      ? m.modals_bulkArchive_description_one({
          count: formatInteger($pendingBulkWorkspaces$.length),
        })
      : m.modals_bulkArchive_description_many({
          count: formatInteger($pendingBulkWorkspaces$.length),
        })}
    confirmText={m.modals_bulkArchive_confirm_label()}
    activeAgentCount={$bulkActiveAgentCount$}
    activeHookCount={$bulkActiveHookCount$}
    guestCount={$bulkGuestCount$}
    openPrCount={$bulkOpenPrCount$}
    preflightReady={$bulkPreflightReady$}
    onConfirm={() => {
      appStore.dispatch(confirmBulkArchive());
    }}
    onCancel={() => appStore.dispatch(closeBulkArchiveConfirm())}
  >
    {#snippet body()}
      <BulkWorkspaceList workspaces={$pendingBulkWorkspaces$} />
    {/snippet}
  </BulkActionConfirmDialog>

  <BulkActionConfirmDialog
    open={$showBulkDeleteConfirm$}
    title={bulkDeleteTitle}
    description={$pendingBulkWorkspaces$.length === 1
      ? m.modals_bulkDelete_description_one({
          count: formatInteger($pendingBulkWorkspaces$.length),
        })
      : m.modals_bulkDelete_description_many({
          count: formatInteger($pendingBulkWorkspaces$.length),
        })}
    confirmText={m.modals_bulkDelete_confirm_label()}
    variant="destructive"
    initialFocus="cancel"
    activeAgentCount={$bulkActiveAgentCount$}
    activeHookCount={$bulkActiveHookCount$}
    guestCount={$bulkGuestCount$}
    openPrCount={$bulkOpenPrCount$}
    preflightReady={$bulkPreflightReady$}
    onConfirm={() => {
      appStore.dispatch(confirmBulkDelete());
    }}
    onCancel={() => appStore.dispatch(closeBulkDeleteConfirm())}
  >
    {#snippet body()}
      <BulkWorkspaceList workspaces={$pendingBulkWorkspaces$} />
    {/snippet}
  </BulkActionConfirmDialog>

  <BulkActionConfirmDialog
    open={$showBulkRetireConfirm$}
    title={bulkOne
      ? m.modals_bulkPurge_title_one({ count: bulkCount })
      : m.modals_bulkPurge_title_many({ count: bulkCount })}
    description={m.modals_bulkPurge_description()}
    confirmText={m.modals_bulkPurge_confirm_label()}
    variant="destructive"
    initialFocus="cancel"
    onConfirm={() => appStore.dispatch(confirmBulkRetire())}
    onCancel={() => appStore.dispatch(closeBulkRetireConfirm())}
  >
    {#snippet body()}
      <BulkWorkspaceList workspaces={$pendingBulkWorkspaces$} />
    {/snippet}
  </BulkActionConfirmDialog>
{/if}
