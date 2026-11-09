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
  let menuOpen = $state(false);
</script>

<Content {tab} {workspaceId} {isActive} />

{#if renderPrimary && header.actions.current?.primary}
  <div data-testid="header-primary-actions">
    {@render header.actions.current.primary()}
  </div>
{/if}

{#if header.actions.current}
  <Menu.Root bind:open={menuOpen}>
    <Menu.Trigger aria-label="Panel actions">Panel actions</Menu.Trigger>
    <Menu.Content portal={false} data-testid="header-actions">
      {@render header.actions.current.conversation?.(menuOpen)}
      {@render header.actions.current.display?.()}
      {@render header.actions.current.actions?.()}
      {@render header.actions.current.destructive?.()}
      {@render header.actions.current.lifecycle?.()}
      {@render header.actions.current.additional?.(menuOpen)}
      {@render header.actions.current.footer?.()}
    </Menu.Content>
  </Menu.Root>
{/if}
