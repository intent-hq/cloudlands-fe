<script lang="ts">
  import type { Workspace } from '$shared/types';

  let { workspace }: { workspace: Workspace } = $props();
</script>

<div data-testid="workspace-hover-card">{workspace.title}</div>
