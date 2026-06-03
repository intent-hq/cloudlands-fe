<script lang="ts">
  /**
   * PanelContentRenderer - Renders content based on tab type
   *
   * This component uses the tab type registry to render the appropriate
   * component for each tab type. All tab-specific logic (state, effects,
   * header actions) is handled by the individual tab type components.
   *
   * Tab types are registered in: src/features/layout/tab-types/register-all.ts
   */

  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { tabTypeRegistry } from '$features/layout/tab-types/registry';

  interface Props {
    tab: PanelTab;
    workspaceId: string;
    /** Whether this tab is currently the active/visible tab */
    isActive?: boolean;
    /** Whether this panel is currently focused AND this tab is active */
    isPanelFocused?: boolean;
    /** Called when content inside the panel receives focus (e.g., clicking in iframe) */
    onFocus?: () => void;
  }

  let { tab, workspaceId, isActive = true, isPanelFocused = false, onFocus }: Props = $props();
</script>

<div class="panel-content-renderer h-full w-full overflow-hidden">
  <!-- Use tab type registry to render the appropriate component -->
  {#if tabTypeRegistry.get(tab.type)}
    {@const tabTypeDef = tabTypeRegistry.get(tab.type)!}
    {@const TabComponent = tabTypeDef.component}
    <TabComponent {tab} {workspaceId} {isActive} {isPanelFocused} {onFocus} />
  {:else}
    <!-- Fallback for unsupported types -->
    <div class="flex flex-col items-center justify-center h-full text-subtle gap-4">
      <div class="text-center">
        <p class="text-lg font-medium text-foreground">{tab.title}</p>
        <p class="text-sm">Type: {tab.type}</p>
        <p class="text-xs mt-4 text-subtle">Content type not yet implemented</p>
      </div>
    </div>
  {/if}
</div>

<style>
  .panel-content-renderer {
    display: flex;
    flex-direction: column;
  }
</style>
