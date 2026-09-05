<script lang="ts">
  import { page } from '$app/state';
  import NewWorkspaceRouteHost from '$features/new-workspace/route/NewWorkspaceRouteHost.svelte';
  import { m } from '$shared/paraglide/messages.js';
</script>

<svelte:head>
  <title>{m.workspace_page_newSpace_title()}</title>
</svelte:head>

{#key page.url.search}
  <NewWorkspaceRouteHost url={page.url} />
{/key}
