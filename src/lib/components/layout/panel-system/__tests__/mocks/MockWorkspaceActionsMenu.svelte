<script lang="ts">
  interface Props {
    onClose?: () => void;
  }
  let { onClose }: Props = $props();
</script>

<button type="button" role="menuitem" onclick={onClose}>Open in mock editor</button>
