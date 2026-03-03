<script lang="ts">
  import { sidebarNavStore } from './sidebar-nav.store.svelte';
  import HomeCard from './cards/HomeCard.svelte';
  import ActiveWorkspacesCard from './cards/ActiveWorkspacesCard.svelte';
  import AllWorkspacesCard from './cards/AllWorkspacesCard.svelte';
  import SettingsCard from './cards/SettingsCard.svelte';
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';

  const MIN_WIDTH = 220;
  const MAX_WIDTH = 480;

  const panelItem = $derived(sidebarNavStore.panelItem);
  const panelWidth = $derived(sidebarNavStore.panelWidth);

  const panelMeta = $derived.by(() => {
    switch (panelItem) {
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

  function handleResizeStart(e: MouseEvent) {
    e.preventDefault();
    isResizing = true;
    const startX = e.clientX;
    const startWidth = panelWidth;

    function onMouseMove(e: MouseEvent) {
      const delta = e.clientX - startX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta));
      sidebarNavStore.panelWidth = newWidth;
    }

    function onMouseUp() {
      isResizing = false;
      sidebarNavStore.setPanelWidth(sidebarNavStore.panelWidth);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }
</script>

{#if panelItem}
  <!-- Outer wrapper animates width; inner content stays at full static width -->
  <div class="shrink-0 h-full overflow-hidden" transition:slide={{ axis: 'x', duration: 200 }}>
    <div class="sidebar-panel h-full flex flex-col relative" style="width: {panelWidth}px;" aria-label="Sidebar panel">
      <!-- Header -->
      <div class="flex items-center justify-between px-3 pt-3 pb-2 shrink-0">
        <div class="min-w-0">
          <h2 class="text-base font-semibold text-foreground">{panelMeta.title}</h2>
          <p class="text-xs text-subtle mt-0.5">{panelMeta.description}</p>
        </div>
        <button
          class="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer shrink-0"
          onclick={() => sidebarNavStore.closePanel()}
          aria-label="Close panel"
        >
          <Fa icon={faXmark} size="xs" />
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 min-h-0 overflow-y-auto">
        {#if panelItem === 'home'}
          <HomeCard />
        {:else if panelItem === 'active'}
          <ActiveWorkspacesCard expanded={true} />
        {:else if panelItem === 'all-workspaces'}
          <AllWorkspacesCard expanded={true} />
        {:else if panelItem === 'settings'}
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
