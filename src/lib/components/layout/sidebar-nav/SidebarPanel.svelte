<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import ActiveWorkspacesCard from './cards/ActiveWorkspacesCard.svelte';
  import AllWorkspacesCard from './cards/AllWorkspacesCard.svelte';
  import ChiefCard from './cards/ChiefCard.svelte';
  import SettingsCard from './cards/SettingsCard.svelte';
  import { slide } from 'svelte/transition';
  import { onDestroy } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    faXmark,
    faEllipsisVertical,
    faMagnifyingGlass,
    faPlus,
  } from '@fortawesome/free-solid-svg-icons';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import * as Menu from '$lib/components/ui/menu';

  import {
    selectPanelItem,
    selectPanelWidth,
    selectCombinedPanelSplit,
    selectOnboardingActive,
    selectAllSpacesViewMode,
    selectShowArchivedWorkspaces,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import {
    closePanel,
    setPanelWidth as setPanelWidthAction,
    setCombinedPanelSplit as setCombinedPanelSplitAction,
    setAllSpacesViewMode,
    setShowArchivedWorkspaces,
    setShowCreateModal,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import {
    isCombinedWorkspacePanelItem,
    type AllSpacesViewMode,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';
  import { store as appStore } from '$store/renderer/store';

  const panelItem$ = selectPanelItem();
  const panelWidth$ = selectPanelWidth();
  const combinedPanelSplit$ = selectCombinedPanelSplit();
  const onboardingActive$ = selectOnboardingActive();
  const allSpacesViewMode$ = selectAllSpacesViewMode();
  const showArchivedWorkspaces$ = selectShowArchivedWorkspaces();

  const allSpacesViewModes = [
    { value: 'recent', label: m.layout_allCard_recent_label() },
    { value: 'repo', label: m.layout_allCard_repo_label() },
    { value: 'status', label: m.layout_allCard_status_label() },
  ] satisfies Array<{ value: AllSpacesViewMode; label: string }>;
  const MIN_WIDTH = 100;
  const MAX_WIDTH = 480;
  const MIN_SPLIT = 0.15;
  const MAX_SPLIT = 0.85;

  // Chief and All Workspaces open the same combined panel:
  // workspace list on top, Chief chat below, separated by a resizable divider.
  const isCombinedWorkspace = $derived(
    $panelItem$ !== null && isCombinedWorkspacePanelItem($panelItem$),
  );

  const panelMeta = $derived.by(() => {
    switch ($panelItem$) {
      case 'active':
        return { title: m.layout_sidebarNav_activeWorkspaces_title(), description: '' };
      case 'settings':
        return {
          title: m.layout_sidebarNav_settings_label(),
          description: m.layout_sidebarPanel_settings_description(),
        };
      default:
        return { title: '', description: '' };
    }
  });

  let isResizing = $state(false);

  let liveWidth = $state($panelWidth$);

  // Whether the workspace-list search input is shown (toggled from the header)
  let searchVisible = $state(false);
  let spacesOptionsOpen = $state(false);

  // Combined-panel vertical split (fraction of height given to the workspace list)
  let splitContainerEl = $state<HTMLDivElement | null>(null);
  let liveSplit = $state($combinedPanelSplit$);
  let isSplitResizing = $state(false);

  // Hoisted cleanup references for split drag
  let splitOnMouseMove: ((ev: MouseEvent) => void) | null = null;
  let splitOnMouseUp: (() => void) | null = null;

  $effect(() => {
    liveSplit = $combinedPanelSplit$;
  });

  function handleSplitResizeStart(e: MouseEvent) {
    const container = splitContainerEl;
    if (!container) return;
    e.preventDefault();
    isSplitResizing = true;
    document.body.classList.add('panel-resizing');
    const rect = container.getBoundingClientRect();

    splitOnMouseMove = (ev: MouseEvent) => {
      const fraction = (ev.clientY - rect.top) / rect.height;
      liveSplit = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, fraction));
    };

    splitOnMouseUp = () => {
      isSplitResizing = false;
      document.body.classList.remove('panel-resizing');
      appStore.dispatch(setCombinedPanelSplitAction(liveSplit));
      if (splitOnMouseMove) window.removeEventListener('mousemove', splitOnMouseMove);
      if (splitOnMouseUp) window.removeEventListener('mouseup', splitOnMouseUp);
      splitOnMouseMove = null;
      splitOnMouseUp = null;
    };

    window.addEventListener('mousemove', splitOnMouseMove);
    window.addEventListener('mouseup', splitOnMouseUp);
  }

  function handleAllSpacesViewModeChange(value: string) {
    const nextMode = allSpacesViewModes.find((option) => option.value === value)?.value;
    if (!nextMode || nextMode === selectAllSpacesViewMode.select(appStore.state)) return;
    appStore.dispatch(setAllSpacesViewMode(nextMode));
  }

  function handleShowArchivedChange(checked: boolean) {
    if (checked === selectShowArchivedWorkspaces.select(appStore.state)) return;
    appStore.dispatch(setShowArchivedWorkspaces(checked));
  }

  // Scroll-fade state: fade out overflowing content at the top/bottom edges
  // of the panel's scroll container, only on the side that actually overflows.
  let contentEl = $state<HTMLDivElement | null>(null);
  let canScrollUp = $state(false);
  let canScrollDown = $state(false);

  function updateScrollFades() {
    const el = contentEl;
    if (!el) return;
    canScrollUp = el.scrollTop > 2;
    canScrollDown = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
  }

  $effect(() => {
    const el = contentEl;
    if (!el) return;
    updateScrollFades();
    const resizeObserver = new ResizeObserver(updateScrollFades);
    resizeObserver.observe(el);
    const mutationObserver = new MutationObserver(updateScrollFades);
    mutationObserver.observe(el, { childList: true, subtree: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  });

  // Keep liveWidth in sync when panelWidth changes from Redux
  $effect(() => {
    liveWidth = $panelWidth$;
  });

  // Hoisted cleanup references for width resize drag
  let resizeOnMouseMove: ((e: MouseEvent) => void) | null = null;
  let resizeOnMouseUp: (() => void) | null = null;
  let resizeRaf: number | null = null;

  function handleResizeStart(e: MouseEvent) {
    e.preventDefault();
    isResizing = true;
    document.body.classList.add('panel-resizing');
    const startX = e.clientX;
    const startWidth = $panelWidth$;

    resizeOnMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      liveWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
      // Push the live width to Redux (rAF-throttled) so title-bar controls
      // aligned to the panel track the width during the drag, not just on release.
      if (resizeRaf === null) {
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = null;
          appStore.dispatch(setPanelWidthAction(liveWidth));
        });
      }
    };

    resizeOnMouseUp = () => {
      isResizing = false;
      document.body.classList.remove('panel-resizing');
      if (resizeRaf !== null) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = null;
      }
      appStore.dispatch(setPanelWidthAction(liveWidth));
      if (resizeOnMouseMove) window.removeEventListener('mousemove', resizeOnMouseMove);
      if (resizeOnMouseUp) window.removeEventListener('mouseup', resizeOnMouseUp);
      resizeOnMouseMove = null;
      resizeOnMouseUp = null;
    };

    window.addEventListener('mousemove', resizeOnMouseMove);
    window.addEventListener('mouseup', resizeOnMouseUp);
  }

  // Clean up global listeners, body classes, and RAF on unmount to prevent leaks
  onDestroy(() => {
    if (isResizing) {
      document.body.classList.remove('panel-resizing');
      if (resizeRaf !== null) {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = null;
      }
    }
    if (isSplitResizing) {
      document.body.classList.remove('panel-resizing');
    }
    // Remove any active event listeners
    if (splitOnMouseMove) window.removeEventListener('mousemove', splitOnMouseMove);
    if (splitOnMouseUp) window.removeEventListener('mouseup', splitOnMouseUp);
    if (resizeOnMouseMove) window.removeEventListener('mousemove', resizeOnMouseMove);
    if (resizeOnMouseUp) window.removeEventListener('mouseup', resizeOnMouseUp);
  });
</script>

{#if $panelItem$ && !$onboardingActive$}
  <!-- Outer wrapper animates width; inner content stays at full static width -->
  <div
    class="shrink-0 h-full overflow-clip [overflow-clip-margin:0.5rem]"
    data-sidebar-panel
    data-panel-item={$panelItem$}
    transition:slide={{ axis: 'x', duration: 200 }}
  >
    <div
      class="sidebar-panel h-full flex flex-col relative text-sidebar-foreground"
      style="width: {liveWidth}px;"
      aria-label={m.layout_sidebarPanel_ariaLabel()}
    >
      {#if isCombinedWorkspace}
        <div
          class="flex-1 min-h-0 flex flex-col"
          bind:this={splitContainerEl}
          data-combined-panel-split
        >
          <div
            class="combined-panel-spaces min-h-0 shrink-0 overflow-hidden flex flex-col"
            style="height: {liveSplit * 100}%;"
            data-combined-panel-spaces
          >
            <!-- Combined workspace panel: workspace list stacked above the Chief chat
               with a draggable horizontal divider between them. -->
            <div class="panel-header shrink-0">
              <div class="min-w-0 flex-1">
                <h2 class="panel-title text-ui font-semibold text-foreground truncate">
                  {m.layout_sidebarNav_allWorkspaces_title()}
                </h2>
              </div>
              <div class="flex items-center gap-0.5 shrink-0">
                <Tooltip
                  content={m.layout_sidebarNav_newWorkspace_title()}
                  side="bottom"
                  sideOffset={4}
                >
                  <button
                    type="button"
                    class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:bg-muted/50 focus-visible:text-foreground"
                    onclick={() => appStore.dispatch(setShowCreateModal(true))}
                    aria-label={m.layout_sidebarNav_newWorkspace_title()}
                    data-spaces-create
                  >
                    <Fa icon={faPlus} size="xs" />
                  </button>
                </Tooltip>
                <Menu.Root bind:open={spacesOptionsOpen}>
                  <Menu.Trigger>
                    {#snippet child({ props })}
                      <Tooltip
                        content={m.layout_sidebarPanel_workspaceListOptions_tooltip()}
                        side="bottom"
                        sideOffset={4}
                      >
                        <button
                          {...props}
                          type="button"
                          class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:bg-muted/50 focus-visible:text-foreground data-[state=open]:bg-muted/50 data-[state=open]:text-foreground"
                          aria-label={m.layout_sidebarPanel_workspaceListOptions_tooltip()}
                          aria-haspopup="menu"
                          aria-expanded={spacesOptionsOpen}
                          data-spaces-options-trigger
                        >
                          <Fa icon={faEllipsisVertical} size="xs" />
                        </button>
                      </Tooltip>
                    {/snippet}
                  </Menu.Trigger>
                  <Menu.Content
                    align="end"
                    class="w-48"
                    aria-label={m.layout_sidebarPanel_workspaceListOptions_tooltip()}
                  >
                    <div
                      role="group"
                      aria-label={m.layout_sidebarPanel_groupBy_label()}
                      data-spaces-view-mode-options
                    >
                      <div class="type-caption px-2 pb-1 pt-1 font-medium text-muted-foreground">
                        {m.layout_sidebarPanel_groupBy_label()}
                      </div>
                      <Menu.RadioGroup
                        value={$allSpacesViewMode$}
                        onValueChange={handleAllSpacesViewModeChange}
                      >
                        {#each allSpacesViewModes as option (option.value)}
                          <Menu.RadioItem value={option.value}>{option.label}</Menu.RadioItem>
                        {/each}
                      </Menu.RadioGroup>
                    </div>
                    <Menu.Separator />
                    <Menu.CheckboxItem
                      checked={$showArchivedWorkspaces$}
                      closeOnSelect={false}
                      onCheckedChange={handleShowArchivedChange}
                    >
                      {m.workspace_home_showArchived_label()}
                    </Menu.CheckboxItem>
                  </Menu.Content>
                </Menu.Root>
                <Tooltip
                  content={searchVisible
                    ? m.layout_sidebarPanel_hideSearch_ariaLabel()
                    : m.layout_sidebarPanel_searchWorkspaces_ariaLabel()}
                  side="bottom"
                  sideOffset={4}
                >
                  <button
                    class="w-8 h-8 flex items-center justify-center rounded-md outline-none transition-colors cursor-pointer focus-visible:bg-muted/50 focus-visible:text-foreground {searchVisible
                      ? 'text-foreground bg-muted/50'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}"
                    onclick={() => (searchVisible = !searchVisible)}
                    aria-label={searchVisible
                      ? m.layout_sidebarPanel_hideSearch_ariaLabel()
                      : m.layout_sidebarPanel_searchWorkspaces_ariaLabel()}
                    aria-pressed={searchVisible}
                    data-combined-panel-search-toggle
                  >
                    <Fa icon={faMagnifyingGlass} size="xs" />
                  </button>
                </Tooltip>
              </div>
            </div>

            <div class="min-h-0 flex-1 overflow-hidden flex flex-col">
              <AllWorkspacesCard expanded={true} {searchVisible} />
            </div>
          </div>

          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="app-resize-handle combined-panel-divider relative shrink-0"
            data-resize-axis="y"
            data-resizing={isSplitResizing}
            data-testid="split-resize-handle"
            onmousedown={handleSplitResizeStart}
            role="separator"
            aria-orientation="horizontal"
            aria-label={m.layout_sidebarPanel_resizeListAndChat_ariaLabel()}
          >
            <div
              class="pointer-events-none h-px w-full bg-border"
              data-combined-panel-divider-border
            ></div>
          </div>

          <!-- overflow-clip with an 8px clip margin (instead of overflow-hidden)
               lets the Chief composer's streaming aurora bleed across the app
               frame's pl-2/pb-2 window inset to the window edges. -->
          <div
            class="min-h-0 flex-1 overflow-clip [overflow-clip-margin:0.5rem] flex flex-col"
            data-combined-panel-chief
          >
            <ChiefCard expanded={true} embedded={true} />
          </div>
        </div>
      {:else}
        <!-- Header -->
        <div class="panel-header shrink-0">
          <div class="min-w-0 flex-1">
            <h2 class="panel-title text-ui font-semibold text-foreground truncate">
              {panelMeta.title}
            </h2>
            {#if panelMeta.description}
              <p class="text-xs text-subtle mt-0.5 truncate">{panelMeta.description}</p>
            {/if}
          </div>
          <div class="flex items-center gap-0.5 shrink-0">
            <button
              class="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
              onclick={() => appStore.dispatch(closePanel())}
              aria-label={m.layout_sidebarPanel_close_ariaLabel()}
            >
              <Fa icon={faXmark} size="xs" />
            </button>
          </div>
        </div>

        <!-- Content -->
        <div
          class="sidebar-panel-content flex-1 min-h-0 overflow-y-auto"
          class:fade-top={canScrollUp}
          class:fade-bottom={canScrollDown}
          bind:this={contentEl}
          onscroll={updateScrollFades}
        >
          {#if $panelItem$ === 'active'}
            <ActiveWorkspacesCard expanded={true} />
          {:else if $panelItem$ === 'settings'}
            <SettingsCard />
          {/if}
        </div>
      {/if}

      <!-- Resize handle (inset to stay within the workspace frame's rounded corners:
           12px radius at the top, 8px mb-2 + 12px radius at the bottom) -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="app-resize-handle absolute -right-2 bottom-5 top-3 z-10 w-4"
        data-resize-axis="x"
        data-resizing={isResizing}
        data-testid="width-resize-handle"
        onmousedown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
      ></div>
    </div>
  </div>
{/if}

{#if isResizing}
  <!-- Overlay to prevent iframe/selection interference during resize -->
  <div class="fixed inset-0 z-50 cursor-col-resize" style="pointer-events: all;"></div>
{/if}

{#if isSplitResizing}
  <div class="fixed inset-0 z-50 cursor-row-resize" style="pointer-events: all;"></div>
{/if}

<style>
  .sidebar-panel {
    container-type: inline-size;
  }

  .sidebar-panel-content {
    container-type: inline-size;
    /* Hide the scrollbar entirely; the edge fades signal scrollability, and
       an 8px right padding keeps the inset symmetric with top/bottom. */
    scrollbar-width: none;
    padding-right: 0.5rem;
    /* Fade out overflowing content at whichever edge has more to scroll. */
    --scroll-fade-top: 0px;
    --scroll-fade-bottom: 0px;
    mask-image: linear-gradient(
      to bottom,
      transparent,
      black var(--scroll-fade-top),
      black calc(100% - var(--scroll-fade-bottom)),
      transparent
    );
  }

  .sidebar-panel-content.fade-top {
    --scroll-fade-top: 1.5rem;
  }

  .sidebar-panel-content.fade-bottom {
    --scroll-fade-bottom: 1.5rem;
  }

  .sidebar-panel-content::-webkit-scrollbar {
    display: none;
  }

  /* Divider between the workspace list and the Chief chat: a 1px line with
     an enlarged invisible hit area for comfortable dragging. */
  .combined-panel-divider {
    padding: 8px 0;
    margin: 0 0.5rem;
    transition:
      height var(--motion-standard) var(--ease-standard),
      margin var(--motion-standard) var(--ease-standard),
      opacity var(--motion-fast) var(--ease-standard),
      padding var(--motion-standard) var(--ease-standard);
  }

  .combined-panel-spaces {
    opacity: 1;
    transition:
      height var(--motion-slow) var(--ease-emphasized-out),
      opacity var(--motion-standard) var(--ease-standard);
  }

  @media (prefers-reduced-motion: reduce) {
    .combined-panel-spaces,
    .combined-panel-divider {
      transition-duration: 0ms;
    }
  }

  /* Default: horizontal header */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.5rem 0.375rem;
    gap: 0.25rem;
  }

  /* Narrow: stack header vertically */
  @container (max-width: 160px) {
    .panel-header {
      flex-direction: column;
      align-items: stretch;
      gap: 0.25rem;
      padding: 0.375rem;
    }
    .panel-title {
      font-size: 12px;
    }
  }
</style>
