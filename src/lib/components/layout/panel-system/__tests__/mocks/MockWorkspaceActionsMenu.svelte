<script lang="ts">
  interface Props {
    onClose?: () => void;
    filePath?: string;
    workspaceId?: string;
  }
  let { onClose, filePath, workspaceId }: Props = $props();
</script>

<button
  type="button"
  role="menuitem"
  data-file-path={filePath}
  data-workspace-id={workspaceId}
  onclick={onClose}>Open in mock editor</button
>
