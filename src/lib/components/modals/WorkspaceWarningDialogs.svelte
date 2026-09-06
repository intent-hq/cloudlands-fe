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
    selectRunningAgentNamesForArchive,
    selectRunningAgentNamesForDelete,
    selectShowArchiveWarning,
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
