<script lang="ts">
  import WorkspaceRouteContextProvider from '../WorkspaceRouteContextProvider.svelte';
  import { workspaceIdFromRoute } from '$lib/utils/workspace-route-context';
  import WorkspaceRouteContextConsumer from './WorkspaceRouteContextConsumer.test.svelte';

  let {
    pathname,
    routeParam,
  }: {
    pathname: string;
    routeParam: string | undefined;
  } = $props();

  const workspaceId = $derived(workspaceIdFromRoute(pathname, routeParam));
</script>

{#key workspaceId}
  <WorkspaceRouteContextProvider {workspaceId}>
    <WorkspaceRouteContextConsumer />
  </WorkspaceRouteContextProvider>
{/key}
