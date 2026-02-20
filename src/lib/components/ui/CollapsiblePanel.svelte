<script lang="ts">
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { slide } from 'svelte/transition';
  import Header from './Header.svelte';
  import Fa from 'svelte-fa';

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

  // Initialize collapsed state from localStorage or default
  let collapsed = $state(
    storageKey && typeof window !== 'undefined'
      ? localStorage.getItem(storageKey) === 'true'
      : defaultCollapsed,
  );

  // Save collapsed state to localStorage when it changes
  $effect(() => {
    if (storageKey && typeof window !== 'undefined') {
      localStorage.setItem(storageKey, String(collapsed));
    }
  });

  function toggleCollapsed() {
    collapsed = !collapsed;
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
          <Fa {icon} size="sm" class="text-muted-foreground opacity-30" />
        {/if}
        <h3 class="m-0 text-sm font-medium">{title}</h3>
        <div
          class="transition-all mt-[2px] duration-200 text-muted-foreground {!hovering &&
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
