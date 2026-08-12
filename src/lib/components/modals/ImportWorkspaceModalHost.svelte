<script lang="ts">
  /**
   * ImportWorkspaceModalHost — Redux host for the "Import Workspace from
   * File…" wizard (global, mounted in the root layout like
   * TransferWorkspaceModalHost). Reads the workspace-import slice and
   * forwards user intent as dispatches; the modal stays presentational.
   */

  import ImportWorkspaceModal from './ImportWorkspaceModal.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    closeImportModal,
    importOpenWorkspaceRequested,
    importStartRequested,
  } from '$store/renderer/slices/workspace-import/workspace-import-slice';
  import {
    selectImportInterruptedAgents,
    selectImportModalOpen,
    selectImportProgress,
    selectImportRunError,
    selectImportRunStatus,
    selectImportStep,
    selectImportWorkspaceTitle,
  } from '$store/renderer/slices/workspace-import/workspace-import-selectors';

  const open$ = selectImportModalOpen();
  const step$ = selectImportStep();
  const runStatus$ = selectImportRunStatus();
  const progress$ = selectImportProgress();
  const runError$ = selectImportRunError();
  const workspaceTitle$ = selectImportWorkspaceTitle();
  const interruptedAgents$ = selectImportInterruptedAgents();
</script>

<ImportWorkspaceModal
  open={$open$}
  step={$step$}
  runStatus={$runStatus$}
  progress={$progress$}
  runError={$runError$}
  workspaceTitle={$workspaceTitle$}
  interruptedAgents={$interruptedAgents$}
  onCancel={() => appStore.dispatch(closeImportModal())}
  onRetry={() => appStore.dispatch(importStartRequested({ reuseLastFile: true }))}
  onOpenWorkspace={() => appStore.dispatch(importOpenWorkspaceRequested())}
/>
