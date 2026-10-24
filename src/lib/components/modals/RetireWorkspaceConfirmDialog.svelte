<script lang="ts">
  import { DestructiveConfirm } from '$lib/components/patterns/confirm';
  import { m } from '$shared/paraglide/messages.js';

  /**
   * Confirms `workspace.retire` (PROTOCOL §5.1 Retired workspaces): the folder
   * on disk is deleted while conversations, notes and tasks stay readable.
   */
  interface Props {
    open?: boolean;
    static?: boolean;
    workspaceTitle: string;
    onConfirm: () => void;
    onCancel: () => void;
  }

  let {
    open = $bindable(false),
    static: staticPosition = false,
    workspaceTitle,
    onConfirm,
    onCancel,
  }: Props = $props();
</script>

<DestructiveConfirm
  bind:open
  static={staticPosition}
  title={m.workspace_retire_confirm_title({ title: workspaceTitle })}
  description={m.workspace_retire_confirm_description()}
  confirmLabel={m.workspace_retire_confirm_action()}
  cancelLabel={m.modals_bulkActionConfirm_cancel_label()}
  focusSubmit={false}
  focusCancel
  {onConfirm}
  {onCancel}
/>
