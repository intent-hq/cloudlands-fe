<script lang="ts">
  import type { Workspace } from '$shared/types';

  interface Props {
    workspace?: Workspace;
    isPinned?: boolean;
    isRunning?: boolean;
    onClick?: (event: MouseEvent) => void;
    [key: string]: unknown;
  }

  let { workspace, isPinned = false, isRunning = false, onClick }: Props = $props();
</script>

<div
  data-testid="workspace-card"
  data-workspace-id={workspace?.id}
  data-pinned={isPinned}
  data-running={isRunning}
  onclick={onClick}
  role="presentation"
>
  {workspace?.title}
</div>

