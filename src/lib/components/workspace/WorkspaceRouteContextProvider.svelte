<script lang="ts">
  import { setContext, untrack, type Snippet } from 'svelte';
  import {
    WORKSPACE_ROUTE_CONTEXT,
    type WorkspaceRouteContext,
  } from '$lib/utils/workspace-route-context';
  import type { WorkspaceId } from '$shared/types/branded-ids';

  type Props = {
    /** Explicit workspace-ID seam for reusable trees outside the route boundary. */
    workspaceId: WorkspaceId | null;
    children: Snippet;
  };

  let { workspaceId, children }: Props = $props();

  const context: WorkspaceRouteContext = Object.freeze({
    workspaceId: untrack(() => workspaceId),
  });
  setContext(WORKSPACE_ROUTE_CONTEXT, context);
</script>

{@render children()}
