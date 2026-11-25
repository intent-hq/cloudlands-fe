<script lang="ts">
  /** Host for the grouped failure toast's "Switch all…" dialog (state owned by the toast saga). */
  import ProviderSwitchDialog from './ProviderSwitchDialog.svelte';
  import { providerSwitchDialog } from '$features/agent/provider-switch-dialog-state';
</script>

<ProviderSwitchDialog
  state={$providerSwitchDialog}
  onSelect={(rowKey, target) => $providerSwitchDialog.actions?.select(rowKey, target)}
  onConfirm={() => $providerSwitchDialog.actions?.confirm()}
  onRetryAll={() => $providerSwitchDialog.actions?.retryAll()}
  onClose={() => $providerSwitchDialog.actions?.close()}
/>
