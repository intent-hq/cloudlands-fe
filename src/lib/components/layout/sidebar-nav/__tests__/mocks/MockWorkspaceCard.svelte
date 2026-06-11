<script lang="ts">
  import type { Workspace } from '$shared/types';

  interface Props {
    workspace?: Workspace;
    isPinned?: boolean;
    [key: string]: unknown;
  }

  let { workspace, isPinned = false }: Props = $props();
</script>

<div data-testid="workspace-card" data-workspace-id={workspace?.id} data-pinned={isPinned}>
  {workspace?.title}
</div>

