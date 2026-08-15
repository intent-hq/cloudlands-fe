<script lang="ts">
  import { getWorkspaceRouteContext } from '$lib/utils/workspace-route-context';

  const context = getWorkspaceRouteContext();
</script>

<div data-testid="workspace-route-id">{context?.workspaceId ?? 'none'}</div>
<div data-testid="workspace-route-context-frozen">{String(Object.isFrozen(context))}</div>
