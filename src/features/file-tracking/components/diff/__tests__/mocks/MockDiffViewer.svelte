<script lang="ts">
  let {
    oldContent = '',
    newContent = '',
    patch = '',
  }: {
    oldContent?: string;
    newContent?: string;
    patch?: string;
  } = $props();
</script>

<pre data-testid="old-content">{oldContent}</pre>
<pre data-testid="new-content">{newContent}</pre>
<pre data-testid="patch">{patch}</pre>
