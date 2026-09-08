<script lang="ts">
  import FileChangesDiffMap from '$lib/components/workspace/sidebar/FileChangesDiffMap.svelte';
  import type { DiffMapDocument } from '../model/types';

  let { document }: { document: DiffMapDocument } = $props();
  let openCount = $state(0);
</script>

<FileChangesDiffMap
  workspaceId="ct-workspace"
  {document}
  layers={{}}
  onOpen={() => (openCount += 1)}
/>
<output data-testid="open-count">{openCount}</output>
