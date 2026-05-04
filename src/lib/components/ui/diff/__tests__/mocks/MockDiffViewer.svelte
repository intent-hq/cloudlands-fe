<script lang="ts">
  let { oldContent = '', newContent = '' }: { oldContent?: string; newContent?: string } = $props();
</script>

<pre data-testid="old-content">{oldContent}</pre>
<pre data-testid="new-content">{newContent}</pre>