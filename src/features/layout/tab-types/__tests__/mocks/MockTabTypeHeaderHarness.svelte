<script lang="ts">
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import type { Component } from 'svelte';

  let {
    component: Content,
    tab,
    workspaceId = 'ws-1',
    isActive = true,
  }: {
    component: Component<Record<string, unknown>>;
    tab: Record<string, unknown>;
    workspaceId?: string;
    isActive?: boolean;
  } = $props();

  const header = createPanelHeaderContext();
</script>

<Content {tab} {workspaceId} {isActive} />

{#if header.actions.current}
  <div data-testid="header-actions">
    {@render header.actions.current()}
  </div>
{/if}
