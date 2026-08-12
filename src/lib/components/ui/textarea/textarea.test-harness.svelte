<script lang="ts">
  import Textarea from './textarea.svelte';

  let { value = $bindable('') }: { value?: string } = $props();
</script>

<label for="workspace-summary">Workspace summary</label>
<Textarea
  id="workspace-summary"
  bind:value
  aria-describedby="workspace-summary-description workspace-summary-error"
  aria-invalid="true"
  doesExpandToFit
  minHeight={64}
  maxHeight={160}
/>
<p id="workspace-summary-description">A short editorial summary.</p>
<p id="workspace-summary-error">A summary is required.</p>
<output data-testid="textarea-value">{value}</output>
