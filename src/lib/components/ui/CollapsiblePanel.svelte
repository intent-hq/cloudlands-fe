<script lang="ts">
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import Fa from 'svelte-fa';
  import {
  requestCollapsiblePanelCollapsed,
  setCollapsiblePanelCollapsed,
} from '$lib/store/slices/ui-layout/ui-layout-slice';
  import { selectCollapsiblePanelCollapsed } from '$lib/store/slices/ui-layout/ui-layout-selectors';
  import { store as appStore } from '$lib/store/store';


  interface Props {
    title: string;
    icon?: any;
    defaultCollapsed?: boolean;
    storageKey?: string;
    class?: string;
    headerClass?: string;
    contentClass?: string;
    showChevronOnHover?: boolean;
    showGradient?: boolean;
    headerActions?: any;
    children?: any;
  }

  let {
    title,
    icon = undefined,
    defaultCollapsed = false,
    storageKey = undefined,
    class: className = '',
    headerClass = '',
    contentClass = '',
    showChevronOnHover = true,
    showGradient = true,
    headerActions = undefined,
    children,
  }: Props = $props();

  const persistedCollapsed = selectCollapsiblePanelCollapsed(storageKey ?? '');

  let collapsed = $state($persistedCollapsed ?? defaultCollapsed);
  let appliedPersistedCollapsed = $state<boolean | undefined>($persistedCollapsed);

  $effect(() => {
    if ($persistedCollapsed !== undefined && $persistedCollapsed !== appliedPersistedCollapsed) {
      collapsed = $persistedCollapsed;
      appliedPersistedCollapsed = $persistedCollapsed;
    }
  });

  onMount(() => {
    if (storageKey) {
      appStore.dispatch(requestCollapsiblePanelCollapsed(storageKey));
    }
  });

  function toggleCollapsed() {
    collapsed = !collapsed;
    if (storageKey) {
      appStore.dispatch(setCollapsiblePanelCollapsed(storageKey, collapsed));
    }
  }

  let hovering = $state(false);
</script>

<div class="w-full flex flex-col h-full {className}">
  <button
    class="relative w-full px-3.5 pt-[0.9rem] z-10 text-left cursor-pointer {headerClass}"
    onclick={toggleCollapsed}
    onmouseenter={() => (hovering = true)}
    onmouseleave={() => (hovering = false)}
    type="button"
  >
    <div class="relative flex items-center gap-2 flex-1">
      <div class="flex-1 flex items-center gap-2">
        {#if icon}
          <Fa {icon} size="sm" class="text-ghost opacity-30" />
        {/if}
        <h3 class="m-0 text-sm font-medium">{title}</h3>
        <div
          class="transition-all mt-[2px] duration-200 text-subtle {!hovering &&
          showChevronOnHover
            ? 'opacity-0'
            : 'opacity-100'} {collapsed ? '-rotate-90' : ''}"
        >
          <Fa icon={faChevronDown} size="xs" />
        </div>
      </div>
      {@render headerActions?.()}
    </div>
  </button>

  {#if !collapsed}
    <div
      class="relative z-0 w-full flex flex-col flex-1 min-h-0 overflow-hidden {contentClass}"
      transition:slide={{ duration: 200 }}
    >
      {#if showGradient}
        <!-- Gradient fade-out at top -->
        <div
          class="absolute -top-2 left-0 right-0 h-2 bg-gradient-to-b from-sidebar to-transparent pointer-events-none z-10"
          aria-hidden="true"
        ></div>
      {/if}

      {@render children()}

      {#if showGradient}
        <!-- Gradient fade-out at bottom -->
        <div
          class="absolute -bottom-2 left-0 right-0 h-2 bg-gradient-to-t from-sidebar to-transparent pointer-events-none z-10"
          aria-hidden="true"
        ></div>
      {/if}
    </div>
  {/if}
</div>
