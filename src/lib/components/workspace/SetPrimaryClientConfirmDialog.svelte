<script lang="ts">
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    static?: boolean;
    currentHost: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  }

  let {
    static: staticPosition = false,
    open = false,
    currentHost,
    onConfirm,
    onCancel,
  }: Props = $props();
</script>

<FormDialog
  static={staticPosition}
  {open}
  class="max-w-sm"
  title={m.workspace_drivingClient_setPrimaryDialog_title()}
  description={m.workspace_drivingClient_setPrimaryDialog_description({ host: currentHost })}
  closeLabel={m.workspace_drivingClient_setPrimaryDialog_close_ariaLabel()}
  cancelLabel={m.workspace_drivingClient_setPrimaryDialog_cancel_label()}
  submitLabel={m.workspace_drivingClient_setPrimaryDialog_confirm_label()}
  submitVariant="primary"
  focusSubmit
  onSubmit={() => onConfirm?.()}
  {onCancel}
/>
