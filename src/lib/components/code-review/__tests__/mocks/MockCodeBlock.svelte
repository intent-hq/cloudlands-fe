<script lang="ts">
  let { code = '' }: { code?: string } = $props();
</script>

<pre data-testid="mock-code-block">{code}</pre>
