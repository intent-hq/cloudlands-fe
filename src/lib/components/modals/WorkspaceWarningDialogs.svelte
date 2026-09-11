<script lang="ts">
  import DeleteWarningDialog from './DeleteWarningDialog.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    closeArchiveWarning,
    closeDeleteWarning,
    confirmArchiveWorkspace,
    confirmDeleteWorkspace,
  } from '$store/renderer/slices/workspace-operations/workspace-operations-slice';
  import {
    selectActiveHookNamesForArchive,
    selectActiveHookNamesForDelete,
    selectLocalChangesForArchive,
    selectLocalChangesForDelete,
    selectOpenPrsForArchive,
    selectOpenPrsForDelete,
    selectRunningAgentsForArchive,
    selectRunningAgentsForDelete,
    selectShowArchiveWarning,
    selectShowDeleteWarning,
  } from '$store/renderer/slices/workspace-operations/workspace-operations-selectors';

  const showDeleteWarning$ = selectShowDeleteWarning();
  const runningAgentsForDelete$ = selectRunningAgentsForDelete();
  const activeHookNamesForDelete$ = selectActiveHookNamesForDelete();
  const openPrsForDelete$ = selectOpenPrsForDelete();
  const localChangesForDelete$ = selectLocalChangesForDelete();
  const showArchiveWarning$ = selectShowArchiveWarning();
  const runningAgentsForArchive$ = selectRunningAgentsForArchive();
  const activeHookNamesForArchive$ = selectActiveHookNamesForArchive();
  const openPrsForArchive$ = selectOpenPrsForArchive();
  const localChangesForArchive$ = selectLocalChangesForArchive();
</script>

<!-- Redux-owned delete warning host (global for all workspace delete entrypoints) -->
<DeleteWarningDialog
  open={$showDeleteWarning$}
  agents={$runningAgentsForDelete$}
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
  agents={$runningAgentsForArchive$}
  hookNames={$activeHookNamesForArchive$}
  openPrs={$openPrsForArchive$}
  localChanges={$localChangesForArchive$}
  onDeleteAnyway={() => appStore.dispatch(confirmArchiveWorkspace())}
  onCancel={() => appStore.dispatch(closeArchiveWarning())}
/>
