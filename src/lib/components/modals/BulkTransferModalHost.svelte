<script lang="ts">
  /** Redux host for the Home bulk transfer dialog. */
  import BulkTransferModal from './BulkTransferModal.svelte';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import { store as appStore } from '$store/renderer/store';
  import {
    bulkTransferCancelRequested,
    bulkTransferStartRequested,
    closeBulkTransferModal,
    selectBulkTransferTarget,
    setBulkTransferArchiveSource,
    setBulkTransferRestartAgents,
  } from '$store/renderer/slices/workspace-bulk-transfer/workspace-bulk-transfer-slice';
  import {
    selectBulkTransferItemList,
    selectBulkTransferState,
  } from '$store/renderer/slices/workspace-bulk-transfer/workspace-bulk-transfer-selectors';
  import { selectTransferTargetConnections } from '$store/renderer/slices/workspace-transfer/workspace-transfer-selectors';

  const state$ = selectBulkTransferState();
  const items$ = selectBulkTransferItemList();
  const connections$ = selectTransferTargetConnections();
</script>

<BulkTransferModal
  open={$state$.open}
  step={$state$.step}
  items={$items$}
  connections={$connections$}
  connectionId={$state$.connectionId}
  restartAgents={$state$.restartAgents}
  archiveSource={$state$.archiveSource}
  currentId={$state$.currentId}
  progress={$state$.progress}
  cancelling={$state$.cancelling}
  onSelectTarget={(id) => appStore.dispatch(selectBulkTransferTarget(id))}
  onSetRestartAgents={(value) => appStore.dispatch(setBulkTransferRestartAgents(value))}
  onSetArchiveSource={(value) => appStore.dispatch(setBulkTransferArchiveSource(value))}
  onConnectDevice={() => {
    appStore.dispatch(closeBulkTransferModal());
    void navigateToSettings({ tab: 'devices' });
  }}
  onStart={() => appStore.dispatch(bulkTransferStartRequested())}
  onStop={() => appStore.dispatch(bulkTransferCancelRequested())}
  onClose={() => appStore.dispatch(closeBulkTransferModal())}
/>
