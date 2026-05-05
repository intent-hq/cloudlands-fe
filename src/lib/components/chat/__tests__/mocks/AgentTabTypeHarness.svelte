<script lang="ts">
  import AgentTabType from '$features/layout/tab-types/AgentTabType.svelte';
  import type { TabTypeComponentProps } from '$features/layout/tab-types/registry';
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';

  let { tab, workspaceId, isActive, isPanelFocused }: TabTypeComponentProps = $props();
  const { actions } = createPanelHeaderContext();
</script>

<AgentTabType {tab} {workspaceId} {isActive} {isPanelFocused} />

{#if actions.current}
  <div data-testid="header-actions">
    {@render actions.current()}
  </div>
{/if}
