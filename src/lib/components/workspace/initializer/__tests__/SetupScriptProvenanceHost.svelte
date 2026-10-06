<script lang="ts">
  import SetupScriptEditor from '../SetupScriptEditor.svelte';
  import type { SetupScriptNameSource } from '$features/setup-scripts';
  let value = $state('echo identical');
  let name = $state('Custom');
  let source = $state<SetupScriptNameSource>('custom');
  let custom = $state(true);
</script>

<SetupScriptEditor
  repoPath="/repo/selected"
  repoConfigScript="echo identical"
  bind:value
  bind:scriptName={name}
  bind:scriptNameSource={source}
  bind:isCustomScript={custom}
/>
<output aria-label="script provenance">{source}</output>
<output aria-label="script content">{value}</output>
