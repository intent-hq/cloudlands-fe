<script lang="ts">
  /** Redux host for the grouped failure toast's "Switch all…" dialog. */
  import ProviderSwitchDialog from './ProviderSwitchDialog.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    providerSwitchConfirmRequested,
    providerSwitchDialogClosed,
    providerSwitchRetryAllRequested,
    providerSwitchTargetChosen,
  } from '$store/renderer/slices/provider-switch-dialog/provider-switch-dialog-slice';
  import { selectProviderSwitchDialog } from '$store/renderer/slices/provider-switch-dialog/provider-switch-dialog-selectors';

  const dialog$ = selectProviderSwitchDialog();
</script>

<ProviderSwitchDialog
  state={$dialog$}
  onSelect={(rowKey, target) => appStore.dispatch(providerSwitchTargetChosen(rowKey, target))}
  onConfirm={() => appStore.dispatch(providerSwitchConfirmRequested())}
  onRetryAll={() => appStore.dispatch(providerSwitchRetryAllRequested())}
  onClose={() => appStore.dispatch(providerSwitchDialogClosed())}
/>
