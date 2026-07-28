<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import HomeCard from './cards/HomeCard.svelte';
  import ActiveWorkspacesCard from './cards/ActiveWorkspacesCard.svelte';
  import AllWorkspacesCard from './cards/AllWorkspacesCard.svelte';
  import ChiefCard from './cards/ChiefCard.svelte';
  import SettingsCard from './cards/SettingsCard.svelte';
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import {
  faXmark,
  faThumbtack,
} from '@fortawesome/free-solid-svg-icons';
  import { Tooltip } from '$lib/components/ui/tooltip';

  import {
  selectPanelItem,
  selectPanelWidth,
  selectIsCardPinned,
  selectOnboardingActive,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import {
  toggleCardPinned,
  closePanel,
  setPanelWidth as setPanelWidthAction,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { store as appStore } from '$store/renderer/store';

  const panelItem$ = selectPanelItem();
  const panelWidth$ = selectPanelWidth();
  const isCardPinned$ = selectIsCardPinned();
  const onboardingActive$ = selectOnboardingActive();

  const MIN_WIDTH = 100;
  const MAX_WIDTH = 480;


  const panelMeta = $derived.by(() => {
    switch ($panelItem$) {
      case 'home':
        return { title: m.layout_sidebarNav_home_label(), description: m.layout_sidebarPanel_home_description() };
      case 'active':
        return { title: m.layout_sidebarNav_activeWorkspaces_title(), description: '' };
      case 'chief':
        return { title: m.layout_sidebarPanel_chief_title(), description: m.layout_sidebarPanel_chief_description() };
      case 'all-workspaces':
        return { title: m.layout_sidebarNav_allWorkspaces_title(), description: '' };
      case 'settings':
        return { title: m.layout_sidebarNav_settings_label(), description: m.layout_sidebarPanel_settings_description() };
      default:
        return { title: '', description: '' };
    }
  });

  let isResizing = $state(false);

  let liveWidth = $state($panelWidth$);

  // Keep liveWidth in sync when panelWidth changes from Redux
  $effect(() => {
    liveWidth = $panelWidth$;
  });

  function handleResizeStart(e: MouseEvent) {
    e.preventDefault();
    isResizing = true;
    const startX = e.clientX;
    const startWidth = $panelWidth$;

    function onMouseMove(e: MouseEvent) {
      const delta = e.clientX - startX;
      liveWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
    }

    function onMouseUp() {
      isResizing = false;
      appStore.dispatch(setPanelWidthAction(liveWidth));
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }
</script>

{#if $panelItem$ && !$onboardingActive$}
  <!-- Outer wrapper animates width; inner content stays at full static width -->
  <div class="shrink-0 h-full overflow-hidden" transition:slide={{ axis: 'x', duration: 200 }}>
    <div class="sidebar-panel h-full flex flex-col relative" style="width: {liveWidth}px;" aria-label={m.layout_sidebarPanel_ariaLabel()}>
      <!-- Header (Chief has its own header) -->
      {#if $panelItem$ !== 'chief'}
      <div class="panel-header shrink-0">
        <div class="min-w-0 flex-1">
          <h2 class="panel-title text-sm font-semibold text-foreground truncate">{panelMeta.title}</h2>
          {#if panelMeta.description}
            <p class="text-xs text-subtle mt-0.5 truncate">{panelMeta.description}</p>
          {/if}
        </div>
        <div class="flex items-center gap-0.5 shrink-0">
          <Tooltip content={$isCardPinned$ ? m.layout_sidebarPanel_unpin_tooltip() : m.layout_sidebarPanel_pin_tooltip()} side="bottom" sideOffset={4}>
            <button
              class="w-6 h-6 flex items-center justify-center rounded-md transition-colors cursor-pointer
                {$isCardPinned$ ? 'text-foreground rotate-0' : 'text-muted-foreground rotate-45 hover:text-foreground hover:bg-muted/50'}"
              onclick={() => appStore.dispatch(toggleCardPinned())}
              aria-label={$isCardPinned$ ? m.layout_sidebarPanel_unpin_tooltip() : m.layout_sidebarPanel_pin_tooltip()}
            >
              <Fa icon={faThumbtack} size="xs" />
            </button>
          </Tooltip>
          <button
            class="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
            onclick={() => appStore.dispatch(closePanel())}
            aria-label={m.layout_sidebarPanel_close_ariaLabel()}
          >
            <Fa icon={faXmark} size="xs" />
          </button>
        </div>
      </div>
      {/if}

      <!-- Content -->
      <div class="sidebar-panel-content flex-1 min-h-0 overflow-y-auto">
        {#if $panelItem$ === 'home'}
          <HomeCard />
        {:else if $panelItem$ === 'active'}
          <ActiveWorkspacesCard expanded={true} />
        {:else if $panelItem$ === 'chief'}
          <ChiefCard expanded={true} />
        {:else if $panelItem$ === 'all-workspaces'}
          <AllWorkspacesCard expanded={true} />
        {:else if $panelItem$ === 'settings'}
          <SettingsCard />
        {/if}
      </div>

      <!-- Resize handle -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="absolute top-0 right-0 w-1 h-full cursor-col-resize z-10
          hover:bg-primary/30 transition-colors
          {isResizing ? 'bg-primary/40' : ''}"
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


<style>
  .sidebar-panel {
    container-type: inline-size;
  }

  .sidebar-panel-content {
    container-type: inline-size;
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