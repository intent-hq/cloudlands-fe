<script lang="ts">
  let { filePath = '' } = $props();
</script>

<button type="button" data-testid="open-combo-button" data-file-path={filePath}>Open</button>
