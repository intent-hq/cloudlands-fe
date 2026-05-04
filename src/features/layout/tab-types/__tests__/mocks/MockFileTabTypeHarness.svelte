<script lang="ts">
  import FileTabType from '../../FileTabType.svelte';
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import type { PanelTab } from '$lib/store/slices/panel-layout/panel-layout-types';

  let {
    tab,
    workspaceId,
    isActive = true,
    isPanelFocused = true,
  }: {
    tab: PanelTab;
    workspaceId: string;
    isActive?: boolean;
    isPanelFocused?: boolean;
  } = $props();

  const { state, actions } = createPanelHeaderContext();
</script>

<div
  data-testid="header-state"
  data-dirty={state.current?.isDirty ?? false}
  data-saving={state.current?.isSaving ?? false}
></div>
<div data-testid="header-actions">
  {#if actions.current}
    {@render actions.current()}
  {/if}
</div>
<FileTabType {tab} {workspaceId} {isActive} {isPanelFocused} />
