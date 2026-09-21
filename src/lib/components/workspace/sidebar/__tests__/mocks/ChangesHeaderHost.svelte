<script lang="ts">
  import type { Snippet } from 'svelte';
  import SidebarChangesPanel from '../../SidebarChangesPanel.svelte';

  let action = $state<Snippet>();
</script>

<header data-testid="changes-test-header">{@render action?.()}</header>
<SidebarChangesPanel workspaceId="ws-1" onRefreshActionChange={(next) => (action = next)} />
