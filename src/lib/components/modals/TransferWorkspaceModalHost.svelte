<script lang="ts">
  /**
   * TransferWorkspaceModalHost — Redux host for the Transfer/Download wizard
   * (global for all workspace entrypoints, same pattern as
   * WorkspaceWarningDialogs). Reads the workspace-transfer slice and forwards
   * user intent as dispatches; the modal itself stays presentational.
   */

  import TransferWorkspaceModal from './TransferWorkspaceModal.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    closeTransferModal,
    selectTransferDestination,
    setTransferArchiveSource,
    setTransferRestartAgents,
    transferFinalizeRequested,
    transferPlanRequested,
    transferStartRequested,
    transferWizardBack,
  } from '$store/renderer/slices/workspace-transfer/workspace-transfer-slice';
  import {
    selectTransferArchiveSource,
    selectTransferDestinationValue,
    selectTransferDownloadFilePath,
    selectTransferFailurePhase,
    selectTransferFinalizeError,
    selectTransferFinalizeStatus,
    selectTransferInterruptedAgents,
    selectTransferModalOpen,
    selectTransferPlan,
    selectTransferPlanError,
    selectTransferPlanStatus,
    selectTransferProgress,
    selectTransferRestartAgents,
    selectTransferRunError,
    selectTransferRunStatus,
    selectTransferStep,
    selectTransferTargetConnections,
    selectTransferWorkspaceTitle,
  } from '$store/renderer/slices/workspace-transfer/workspace-transfer-selectors';

  const open$ = selectTransferModalOpen();
  const workspaceTitle$ = selectTransferWorkspaceTitle();
  const step$ = selectTransferStep();
  const connections$ = selectTransferTargetConnections();
  const destination$ = selectTransferDestinationValue();
  const planStatus$ = selectTransferPlanStatus();
  const plan$ = selectTransferPlan();
  const planError$ = selectTransferPlanError();
  const runStatus$ = selectTransferRunStatus();
  const progress$ = selectTransferProgress();
  const runError$ = selectTransferRunError();
  const failurePhase$ = selectTransferFailurePhase();
  const restartAgents$ = selectTransferRestartAgents();
  const downloadFilePath$ = selectTransferDownloadFilePath();
  const interruptedAgents$ = selectTransferInterruptedAgents();
  const archiveSource$ = selectTransferArchiveSource();
  const finalizeStatus$ = selectTransferFinalizeStatus();
  const finalizeError$ = selectTransferFinalizeError();
</script>

<TransferWorkspaceModal
  open={$open$}
  workspaceTitle={$workspaceTitle$}
  step={$step$}
  connections={$connections$}
  destination={$destination$}
  planStatus={$planStatus$}
  plan={$plan$}
  planError={$planError$}
  runStatus={$runStatus$}
  progress={$progress$}
  runError={$runError$}
  failurePhase={$failurePhase$}
  restartAgents={$restartAgents$}
  downloadFilePath={$downloadFilePath$}
  interruptedAgents={$interruptedAgents$}
  archiveSource={$archiveSource$}
  finalizeStatus={$finalizeStatus$}
  finalizeError={$finalizeError$}
  onSelectDestination={(destination) => appStore.dispatch(selectTransferDestination(destination))}
  onNext={() => appStore.dispatch(transferPlanRequested())}
  onBack={() => appStore.dispatch(transferWizardBack())}
  onCancel={() => appStore.dispatch(closeTransferModal())}
  onStart={() => appStore.dispatch(transferStartRequested())}
  onRetry={() => appStore.dispatch(transferStartRequested())}
  onSetRestartAgents={(value) => appStore.dispatch(setTransferRestartAgents(value))}
  onSetArchiveSource={(value) => appStore.dispatch(setTransferArchiveSource(value))}
  onFinalize={(switchToTarget) => appStore.dispatch(transferFinalizeRequested({ switchToTarget }))}
/>
