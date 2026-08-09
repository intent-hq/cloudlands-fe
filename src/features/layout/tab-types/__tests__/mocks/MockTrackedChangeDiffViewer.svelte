<script lang="ts">
  let { change }: { change?: { file?: string } } = $props();
</script>

<div data-testid="tracked-change-diff-viewer" data-file={change?.file ?? ''}></div>
