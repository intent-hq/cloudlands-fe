<script lang="ts">
  /** SidebarNav - Compact global navigation for the window title bar. */

  import { m } from '$shared/paraglide/messages.js';
  import type { SidebarNavItem } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';
  import { isCombinedWorkspacePanelItem } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';
  import { Button } from '$lib/components/ui/button';
  import IntentNavigationIcon from '$lib/icons/IntentNavigationIcon.svelte';
  import { cn } from '$lib/utils';
  import {
    TITLEBAR_NAVIGATION_CONTROL_CLASS,
    TITLEBAR_NAVIGATION_GLYPH_CLASS,
  } from '../titlebar-navigation';
  import TitlebarNavigationTooltip from '../TitlebarNavigationTooltip.svelte';

  import {
    selectPanelItem,
    selectWorkspaceCreationActive,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { togglePanel } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { store as appStore } from '$store/renderer/store';
  const panelItem$ = selectPanelItem();
  const workspaceCreationActive$ = selectWorkspaceCreationActive();

  const navItems: { id: SidebarNavItem }[] = [{ id: 'all-workspaces' }];

  function isItemActive(id: SidebarNavItem): boolean {
    // Highlight the workspace button for either half of the combined panel.
    if ($panelItem$ === id) return true;
    if (
      id === 'all-workspaces' &&
      $panelItem$ !== null &&
      isCombinedWorkspacePanelItem($panelItem$)
    )
      return true;
    return false;
  }

  function handleClick(id: SidebarNavItem) {
    // Primary activation toggles the persistent combined Spaces + Chief panel.
    appStore.dispatch(togglePanel(id));
  }
</script>

{#if !$workspaceCreationActive$}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <nav
    class="group/nav sidebar-nav flex h-8 shrink-0 items-center gap-0.5"
    aria-label={m.layout_sidebarNav_ariaLabel()}
    data-top-navigation
  >
    <div class="flex items-center gap-0.5">
      {#each navItems as item (item.id)}
        {@const active = isItemActive(item.id)}
        <TitlebarNavigationTooltip
          label={m.layout_titleBar_toggleSidebar_ariaLabel()}
          shortcut="mod+o"
        >
          <Button
            variant="ghost-light"
            size="icon"
            iconOnly
            class={cn('sidebar-nav-btn relative', TITLEBAR_NAVIGATION_CONTROL_CLASS)}
            onclick={() => handleClick(item.id)}
            aria-label={m.layout_titleBar_toggleSidebar_ariaLabel()}
            aria-pressed={active}
            data-nav-item={item.id}
            data-titlebar-spaces-control
          >
            <span class={TITLEBAR_NAVIGATION_GLYPH_CLASS} data-titlebar-navigation-glyph>
              <IntentNavigationIcon
                name="dandelion"
                size={16}
                class="pointer-events-none size-4!"
              />
            </span>
          </Button>
        </TitlebarNavigationTooltip>
      {/each}
    </div>
  </nav>
{/if}
