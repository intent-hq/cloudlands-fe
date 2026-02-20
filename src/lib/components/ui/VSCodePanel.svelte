<script lang="ts">
  import { faChevronLeft } from '@fortawesome/free-solid-svg-icons';
  import type { Snippet } from 'svelte';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';

  import { slide } from 'svelte/transition';

  interface Props {
    title: string;
    icon?: any; // FontAwesome icon
    defaultCollapsed?: boolean;
    collapsed?: boolean; // Allow external control
    storageKey?: string;
    collapsible?: boolean;
    class?: string;
    headerClass?: string;
    contentClass?: string;
    showAction?: boolean;
    actionIcon?: any;
    actionLabel?: string;
    actionDisabled?: boolean;
    loading?: boolean;
    onAction?: () => void;
    onCollapse?: () => void; // Callback for external collapse handling
    headerActions?: Snippet;
    children?: Snippet;
  }

  let {
    title,
    icon = undefined,
    defaultCollapsed = false,
    collapsed: externalCollapsed = undefined,
    storageKey = undefined,
    collapsible = true,
    class: className = '',
    headerClass = '',
    contentClass = '',
    showAction = false,
    actionIcon = undefined,
    actionLabel = '',
    actionDisabled = false,
    loading = false,
    onAction = undefined,
    onCollapse = undefined,
    headerActions = undefined,
    children,
  }: Props = $props();

  // Use external collapsed state if provided, otherwise manage internally
  // Note: We intentionally capture storageKey and defaultCollapsed at initialization
  // svelte-ignore state_referenced_locally
  let internalCollapsed = $state(
    storageKey && typeof window !== 'undefined'
      ? localStorage.getItem(storageKey) === 'true'
      : defaultCollapsed,
  );

  // Determine which collapsed state to use
  let collapsed = $derived(externalCollapsed !== undefined ? externalCollapsed : internalCollapsed);

  // Save collapsed state to localStorage when it changes (only if managing internally)
  $effect(() => {
    if (externalCollapsed === undefined && storageKey && typeof window !== 'undefined') {
      localStorage.setItem(storageKey, String(internalCollapsed));
    }
  });
  // Note: contentId is intentionally stable across the component's lifecycle
  // svelte-ignore state_referenced_locally
  const contentId = storageKey
    ? `${storageKey}-content`
    : `panel-${Math.random().toString(36).slice(2)}-content`;

  function toggleCollapsed() {
    if (collapsible) {
      if (onCollapse) {
        // Let external handler manage the state
        onCollapse();
      } else {
        // Manage internally
        internalCollapsed = !internalCollapsed;
      }
    }
  }

  function handleAction(e: MouseEvent) {
    e.stopPropagation();
    onAction?.();
  }
</script>

<div class={`flex flex-col w-full h-full min-h-0 overflow-hidden relative ${className}`}>
  <!-- Header -->
  <div
    class="group/panel-header flex items-center w-full h-8 px-2.5 transition-colors duration-100 hover:bg-background"
  >
    <Button
      variant="plain"
      size="xs"
      class={`flex-1 h-full flex items-center gap-1.5 rounded-none text-left text-muted-foreground ${headerClass}`}
      onclick={toggleCollapsed}
      disabled={!collapsible}
      type="button"
      aria-expanded={!collapsed}
      aria-controls={contentId}
    >
      {#if icon}
        <div class="flex items-center justify-center shrink-0 text-muted-foreground/60">
          <Fa {icon} size="14" />
        </div>
      {/if}

      <span
        class="flex-1 text-[11px] font-semibold tracking-wide uppercase overflow-hidden text-ellipsis whitespace-nowrap group-hover/panel-header:text-foreground"
      >
        {title}
      </span>
    </Button>

    <div class="flex items-center gap-0.5 h-full px-0.5">
      {#if headerActions}
        {@render headerActions()}
      {/if}
      {#if showAction && actionIcon}
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={handleAction}
          disabled={actionDisabled || loading}
          tooltip={actionLabel}
          aria-label={actionLabel}
          class="opacity-0 group-hover/panel-header:opacity-70 hover:opacity-100"
        >
          <Fa icon={actionIcon} size="xs" />
        </Button>
      {/if}
    </div>

    {#if collapsible}
      <Button
        variant="plain"
        size="xs"
        onclick={toggleCollapsed}
        type="button"
        aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
        class="h-full px-2 text-muted-foreground"
      >
        <div
          class="flex items-center justify-center shrink-0 transition-transform duration-150 ease-linear opacity-0 group-hover/panel-header:opacity-60"
          class:opacity-70={collapsed}
          class:rotate-0={collapsed}
          class:-rotate-90={!collapsed}
        >
          <Fa icon={faChevronLeft} size="10" />
        </div>
      </Button>
    {/if}
  </div>

  <!-- Content -->
  {#if !collapsed}
    <div
      id={contentId}
      class={`flex-1 min-h-0 overflow-hidden flex flex-col ${contentClass}`}
      transition:slide={{ duration: 150 }}
    >
      {#if children}
        {@render children()}
      {/if}
    </div>
  {/if}
</div>

<!-- All styles converted to Tailwind classes in the template above -->
