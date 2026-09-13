<script lang="ts">
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import AgentTabType from '../../AgentTabType.svelte';

  let { tab, workspaceId, isActive = true, isPanelFocused = true } = $props();
  const header = createPanelHeaderContext();
</script>

<AgentTabType {tab} {workspaceId} {isActive} {isPanelFocused} />

{#if header.actions.current?.primary}
  <div data-testid="agent-primary-header-actions">
    {@render header.actions.current.primary()}
  </div>
{/if}
