<script lang="ts">
  import type { Workspace } from '$shared/types';

  interface Props {
    workspace?: Workspace;
    isPinned?: boolean;
    isRunning?: boolean;
    [key: string]: unknown;
  }

  let { workspace, isPinned = false, isRunning = false }: Props = $props();
</script>

<div
  data-testid="workspace-card"
  data-workspace-id={workspace?.id}
  data-pinned={isPinned}
  data-running={isRunning}
>
  {workspace?.title}
</div>

