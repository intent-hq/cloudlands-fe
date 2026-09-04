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

  import { m } from '$shared/paraglide/messages.js';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { tabTypeRegistry, type TabTypeComponent } from '$features/layout/tab-types/registry';
  import { Button } from '$lib/components/ui/button';
  import { isAlwaysMountedTab } from './panel-tab-cache';

  interface Props {
    tab: PanelTab;
    workspaceId: string;
    layoutId: string;
    /** Whether this tab is currently the active/visible tab */
    isActive?: boolean;
    /** Whether this panel is currently focused AND this tab is active */
    isPanelFocused?: boolean;
    /** Called when content inside the panel receives focus (e.g., clicking in iframe) */
    onFocus?: () => void;
  }

  let {
    tab,
    workspaceId,
    layoutId,
    isActive = true,
    isPanelFocused = false,
    onFocus,
  }: Props = $props();

  let renderAttempt = $state(0);
  let renderedType = $state<string | null>(null);
  let TabComponent = $state<TabTypeComponent>();
  let loadFailed = $state(false);
  const tabTypeDef = $derived.by(() => {
    void renderAttempt;
    return tabTypeRegistry.get(tab.type);
  });

  $effect(() => {
    const type = tab.type;
    const active = isActive;
    const shouldMount = active || isAlwaysMountedTab(tab);
    const attempt = renderAttempt;
    const definition = tabTypeDef;
    let cancelled = false;

    if (!definition || renderedType !== type) {
      renderedType = null;
      TabComponent = undefined;
      loadFailed = false;
    }
    if (!definition || (renderedType === type && TabComponent) || !shouldMount) return;

    loadFailed = false;
    void tabTypeRegistry.loadComponent(type).then(
      (component) => {
        if (
          cancelled ||
          (!isActive && !isAlwaysMountedTab(tab)) ||
          tab.type !== type ||
          renderAttempt !== attempt
        )
          return;
        renderedType = type;
        TabComponent = component;
      },
      () => {
        if (
          cancelled ||
          (!isActive && !isAlwaysMountedTab(tab)) ||
          tab.type !== type ||
          renderAttempt !== attempt
        )
          return;
        loadFailed = true;
      },
    );

    return () => {
      cancelled = true;
    };
  });

  function retryLoad() {
    tabTypeRegistry.resetComponentLoad(tab.type);
    renderAttempt += 1;
  }
</script>

<div class="panel-content-renderer h-full w-full overflow-hidden">
  {#if tabTypeDef}
    {#if renderedType === tab.type && TabComponent}
      <TabComponent {tab} {workspaceId} {layoutId} {isActive} {isPanelFocused} {onFocus} />
    {:else if isActive && loadFailed}
      <div class="flex h-full flex-col items-center justify-center gap-3 text-subtle">
        <p>{m.error_boundary_title()}</p>
        <Button variant="outline" size="sm" onclick={retryLoad}>
          {m.ui_errorToast_retry_label()}
        </Button>
      </div>
    {:else if isActive}
      <div
        class="flex h-full w-full items-center justify-center"
        role="status"
        aria-label={m.workspace_hoverCard_loading_label()}
      >
        <div class="size-5 animate-pulse rounded-full bg-muted motion-reduce:animate-none"></div>
      </div>
    {/if}
  {:else}
    <!-- Fallback for unsupported types -->
    <div class="flex flex-col items-center justify-center h-full text-subtle gap-4">
      <div class="text-center">
        <p class="text-lg font-medium text-foreground">{tab.title}</p>
        <p class="text-sm">{m.layout_panelContent_typeLabel({ type: tab.type })}</p>
        <p class="text-xs mt-4 text-subtle">{m.layout_panelContent_notImplemented_label()}</p>
        <Button class="mt-4" variant="outline" size="sm" onclick={retryLoad}>
          {m.ui_errorToast_retry_label()}
        </Button>
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
