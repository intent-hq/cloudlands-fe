<script lang="ts">
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import NoteTabType from '../../NoteTabType.svelte';

  let { tab, workspaceId = 'ws-1', isActive = true, isPanelFocused = true } = $props();

  const header = createPanelHeaderContext();
</script>

<NoteTabType {tab} {workspaceId} {isActive} {isPanelFocused} />

{#if header.actions.current}
  <div data-testid="header-actions">
    {@render header.actions.current()}
  </div>
{/if}
