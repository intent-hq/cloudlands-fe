<script lang="ts">
  import FileTabType from '../../FileTabType.svelte';
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';

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
    <Menu.Root>
      <!-- i18n-ignore (test harness) -->
      <Menu.Trigger aria-label="Panel actions">Panel actions</Menu.Trigger>
      <Menu.Content portal={false}>
        {@render actions.current.display?.()}
        {@render actions.current.actions?.()}
      </Menu.Content>
    </Menu.Root>
  {/if}
</div>
<FileTabType {tab} {workspaceId} {isActive} {isPanelFocused} />
