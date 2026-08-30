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
  const showArchiveWarning$ = selectShowArchiveWarning();
  const runningAgentNamesForArchive$ = selectRunningAgentNamesForArchive();
  const activeHookNamesForArchive$ = selectActiveHookNamesForArchive();
  const openPrsForArchive$ = selectOpenPrsForArchive();
</script>

<!-- Redux-owned delete warning host (global for all workspace delete entrypoints) -->
<DeleteWarningDialog
  open={$showDeleteWarning$}
  agentNames={$runningAgentNamesForDelete$}
  hookNames={$activeHookNamesForDelete$}
  openPrs={$openPrsForDelete$}
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
  onDeleteAnyway={() => appStore.dispatch(confirmArchiveWorkspace())}
  onCancel={() => appStore.dispatch(closeArchiveWarning())}
/>
