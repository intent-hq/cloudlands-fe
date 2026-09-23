<script lang="ts">
  import BulkActionConfirmDialog from './BulkActionConfirmDialog.svelte';
  import BulkWorkspaceList from './BulkWorkspaceList.svelte';
  import { untrack } from 'svelte';
  import { readable } from 'svelte/store';
  import type { ComponentProps } from 'svelte';
  import DeleteWarningDialog from './DeleteWarningDialog.svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import {
    closeBulkArchiveConfirm,
    closeBulkDeleteConfirm,
    closeArchiveWarning,
    closeDeleteWarning,
    confirmBulkArchive,
    confirmBulkDelete,
    confirmArchiveWorkspace,
    confirmDeleteWorkspace,
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
    selectLocalChangesForArchive,
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
    selectShowDeleteWarning,
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
  const localChangesForArchive$ = untrack(() =>
    staticData ? readable(undefined) : selectLocalChangesForArchive(),
  );
  const showBulkArchiveConfirm$ = untrack(() =>
    staticData ? readable(undefined) : selectShowBulkArchiveConfirm(),
  );
  const showBulkDeleteConfirm$ = untrack(() =>
    staticData ? readable(undefined) : selectShowBulkDeleteConfirm(),
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
    localChanges={$localChangesForArchive$}
    guests={$guestsForArchive$}
    onDeleteAnyway={() => appStore.dispatch(confirmArchiveWorkspace())}
    onCancel={() => appStore.dispatch(closeArchiveWarning())}
  />
  <BulkActionConfirmDialog
    open={$showBulkArchiveConfirm$}
    mode="archive"
    title={m.modals_bulkArchive_title({ group: $pendingBulkGroupLabel$ ?? '' })}
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
    onConfirm={() => appStore.dispatch(confirmBulkArchive())}
    onCancel={() => appStore.dispatch(closeBulkArchiveConfirm())}
  >
    {#snippet body()}
      <BulkWorkspaceList workspaces={$pendingBulkWorkspaces$} />
    {/snippet}
  </BulkActionConfirmDialog>

  <BulkActionConfirmDialog
    open={$showBulkDeleteConfirm$}
    title={m.modals_bulkDelete_title({ group: $pendingBulkGroupLabel$ ?? '' })}
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
    onConfirm={() => appStore.dispatch(confirmBulkDelete())}
    onCancel={() => appStore.dispatch(closeBulkDeleteConfirm())}
  >
    {#snippet body()}
      <BulkWorkspaceList workspaces={$pendingBulkWorkspaces$} />
    {/snippet}
  </BulkActionConfirmDialog>
{/if}
