<script lang="ts">
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import type { Component } from 'svelte';

  let {
    component: Content,
    tab,
    workspaceId = 'ws-1',
    isActive = true,
    renderPrimary = false,
  }: {
    component: Component<Record<string, unknown>>;
    tab: Record<string, unknown>;
    workspaceId?: string;
    isActive?: boolean;
    renderPrimary?: boolean;
  } = $props();

  const header = createPanelHeaderContext();
</script>

<Content {tab} {workspaceId} {isActive} />

{#if renderPrimary && header.actions.current?.primary}
  <div data-testid="header-primary-actions">
    {@render header.actions.current.primary()}
  </div>
{/if}

{#if header.actions.current}
  <Menu.Root>
    <Menu.Trigger aria-label="Panel actions">Panel actions</Menu.Trigger>
    <Menu.Content portal={false} data-testid="header-actions">
      {@render header.actions.current.display?.()}
      <Menu.Separator />
      {@render header.actions.current.actions?.()}
    </Menu.Content>
  </Menu.Root>
{/if}
