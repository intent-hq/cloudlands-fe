<script lang="ts">
  import HomeCard from './cards/HomeCard.svelte';
  import ActiveWorkspacesCard from './cards/ActiveWorkspacesCard.svelte';
  import AllWorkspacesCard from './cards/AllWorkspacesCard.svelte';
  import SettingsCard from './cards/SettingsCard.svelte';
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import {
  faXmark,
  faThumbtack,
} from '@fortawesome/free-solid-svg-icons';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import {
  selectPanelItem,
  selectPanelWidth,
  selectIsCardPinned,
  selectOnboardingActive,
} from '$lib/store/slices/sidebar-nav/sidebar-nav-selectors';
  import {
  toggleCardPinned,
  closePanel,
  setPanelWidth as setPanelWidthAction,
} from '$lib/store/slices/sidebar-nav/sidebar-nav-slice';

  const dispatch = getDispatch();
  const panelItem$ = selectPanelItem();
  const panelWidth$ = selectPanelWidth();
  const isCardPinned$ = selectIsCardPinned();
  const onboardingActive$ = selectOnboardingActive();

  const MIN_WIDTH = 100;
  const MAX_WIDTH = 480;


  const panelMeta = $derived.by(() => {
    switch ($panelItem$) {
      case 'home':
        return { title: 'Home', description: 'Your workspace dashboard' };
      case 'active':
        return { title: 'Active workspaces', description: '' };
      case 'all-workspaces':
        return { title: 'All workspaces', description: '' };
      case 'settings':
        return { title: 'Settings', description: 'Accounts, agents, and preferences' };
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
      dispatch(setPanelWidthAction(liveWidth));
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
    <div class="sidebar-panel h-full flex flex-col relative" style="width: {liveWidth}px;" aria-label="Sidebar panel">
      <!-- Header -->
      <div class="panel-header shrink-0">
        <div class="min-w-0 flex-1">
          <h2 class="panel-title text-sm font-semibold text-foreground truncate">{panelMeta.title}</h2>
          {#if panelMeta.description}
            <p class="text-xs text-subtle mt-0.5 truncate">{panelMeta.description}</p>
          {/if}
        </div>
        <div class="flex items-center gap-0.5 shrink-0">
          <Tooltip content={$isCardPinned$ ? 'Unpin panel' : 'Pin panel open'} side="bottom" sideOffset={4}>
            <button
              class="w-6 h-6 flex items-center justify-center rounded-md transition-colors cursor-pointer
                {$isCardPinned$ ? 'text-foreground rotate-0' : 'text-muted-foreground rotate-45 hover:text-foreground hover:bg-muted/50'}"
              onclick={() => dispatch(toggleCardPinned())}
              aria-label={$isCardPinned$ ? 'Unpin panel' : 'Pin panel open'}
            >
              <Fa icon={faThumbtack} size="xs" />
            </button>
          </Tooltip>
          <button
            class="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
            onclick={() => dispatch(closePanel())}
            aria-label="Close panel"
          >
            <Fa icon={faXmark} size="xs" />
          </button>
        </div>
      </div>

      <!-- Content -->
      <div class="sidebar-panel-content flex-1 min-h-0 overflow-y-auto">
        {#if $panelItem$ === 'home'}
          <HomeCard />
        {:else if $panelItem$ === 'active'}
          <ActiveWorkspacesCard expanded={true} />
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