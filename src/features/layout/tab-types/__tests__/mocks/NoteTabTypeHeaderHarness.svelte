<script lang="ts">
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import NoteTabType from '../../NoteTabType.svelte';

  let { tab, workspaceId = 'ws-1', isActive = true, isPanelFocused = true } = $props();

  const header = createPanelHeaderContext();
</script>

<NoteTabType {tab} {workspaceId} {isActive} {isPanelFocused} />

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
