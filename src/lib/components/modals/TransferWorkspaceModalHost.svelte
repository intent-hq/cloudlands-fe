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
    transferPlanRequested,
    transferWizardBack,
  } from '$store/renderer/slices/workspace-transfer/workspace-transfer-slice';
  import {
    selectTransferDestinationValue,
    selectTransferModalOpen,
    selectTransferPlan,
    selectTransferPlanError,
    selectTransferPlanStatus,
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
  onSelectDestination={(destination) => appStore.dispatch(selectTransferDestination(destination))}
  onNext={() => appStore.dispatch(transferPlanRequested())}
  onBack={() => appStore.dispatch(transferWizardBack())}
  onCancel={() => appStore.dispatch(closeTransferModal())}
/>
