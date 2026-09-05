<script lang="ts">
  import BulkActionConfirmDialog from './BulkActionConfirmDialog.svelte';
  import BulkWorkspaceList from './BulkWorkspaceList.svelte';
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
    selectLocalChangesForArchive,
    selectLocalChangesForDelete,
    selectOpenPrsForArchive,
    selectOpenPrsForDelete,
    selectPendingBulkGroupLabel,
    selectPendingBulkWorkspaces,
    selectPendingBulkWorkspaceIds,
    selectRunningAgentNamesForArchive,
    selectRunningAgentNamesForDelete,
    selectShowArchiveWarning,
    selectShowBulkArchiveConfirm,
    selectShowBulkDeleteConfirm,
    selectShowDeleteWarning,
  } from '$store/renderer/slices/workspace-operations/workspace-operations-selectors';

  const showDeleteWarning$ = selectShowDeleteWarning();
  const runningAgentNamesForDelete$ = selectRunningAgentNamesForDelete();
  const activeHookNamesForDelete$ = selectActiveHookNamesForDelete();
  const openPrsForDelete$ = selectOpenPrsForDelete();
  const localChangesForDelete$ = selectLocalChangesForDelete();
  const showArchiveWarning$ = selectShowArchiveWarning();
  const runningAgentNamesForArchive$ = selectRunningAgentNamesForArchive();
  const activeHookNamesForArchive$ = selectActiveHookNamesForArchive();
  const openPrsForArchive$ = selectOpenPrsForArchive();
  const localChangesForArchive$ = selectLocalChangesForArchive();
  const showBulkArchiveConfirm$ = selectShowBulkArchiveConfirm();
  const showBulkDeleteConfirm$ = selectShowBulkDeleteConfirm();
  const pendingBulkWorkspaceIds$ = selectPendingBulkWorkspaceIds();
  const pendingBulkWorkspaces$ = selectPendingBulkWorkspaces();
  const pendingBulkGroupLabel$ = selectPendingBulkGroupLabel();
  const bulkActiveAgentCount$ = selectBulkActiveAgentCount();
  const bulkActiveHookCount$ = selectBulkActiveHookCount();
</script>

<!-- Redux-owned delete warning host (global for all workspace delete entrypoints) -->
<DeleteWarningDialog
  open={$showDeleteWarning$}
  agentNames={$runningAgentNamesForDelete$}
  hookNames={$activeHookNamesForDelete$}
  openPrs={$openPrsForDelete$}
  localChanges={$localChangesForDelete$}
  onDeleteAnyway={() => appStore.dispatch(confirmDeleteWorkspace())}
  onCancel={() => appStore.dispatch(closeDeleteWarning())}
/>

<!-- Redux-owned archive warning host (global for all workspace archive entrypoints) -->
<DeleteWarningDialog
  open={$showArchiveWarning$}
  mode="archive"
  agentNames={$runningAgentNamesForArchive$}
  hookNames={$activeHookNamesForArchive$}
  openPrs={$openPrsForArchive$}
  localChanges={$localChangesForArchive$}
  onDeleteAnyway={() => appStore.dispatch(confirmArchiveWorkspace())}
  onCancel={() => appStore.dispatch(closeArchiveWarning())}
/>

<BulkActionConfirmDialog
  open={$showBulkArchiveConfirm$}
  title={m.modals_bulkArchive_title({ group: $pendingBulkGroupLabel$ ?? '' })}
  description={$pendingBulkWorkspaceIds$.length === 1
    ? m.modals_bulkArchive_description_one({
        count: formatInteger($pendingBulkWorkspaceIds$.length),
      })
    : m.modals_bulkArchive_description_many({
        count: formatInteger($pendingBulkWorkspaceIds$.length),
      })}
  confirmText={m.modals_bulkArchive_confirm_label()}
  activeAgentCount={$bulkActiveAgentCount$}
  activeHookCount={$bulkActiveHookCount$}
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
  description={$pendingBulkWorkspaceIds$.length === 1
    ? m.modals_bulkDelete_description_one({
        count: formatInteger($pendingBulkWorkspaceIds$.length),
      })
    : m.modals_bulkDelete_description_many({
        count: formatInteger($pendingBulkWorkspaceIds$.length),
      })}
  confirmText={m.modals_bulkDelete_confirm_label()}
  variant="destructive"
  activeAgentCount={$bulkActiveAgentCount$}
  activeHookCount={$bulkActiveHookCount$}
  onConfirm={() => appStore.dispatch(confirmBulkDelete())}
  onCancel={() => appStore.dispatch(closeBulkDeleteConfirm())}
>
  {#snippet body()}
    <BulkWorkspaceList workspaces={$pendingBulkWorkspaces$} />
  {/snippet}
</BulkActionConfirmDialog>
