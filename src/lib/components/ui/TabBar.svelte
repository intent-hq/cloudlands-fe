<script lang="ts" module>
  import { scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';

  // Safe non-deferred transition functions replacing crossfade.
  //
  // crossfade returns *deferred* transitions (functions), and Svelte's internal
  // facade for deferred transitions calls `a.reset()` / `a.deactivate()` on an
  // animation object (`a`) that is assigned in a microtask. If the facade methods
  // are called before the microtask runs (which happens during {#each} block
  // reconciliation), it crashes with:
  //   "Cannot read properties of undefined (reading 'reset')"
  //
  // By returning plain AnimationConfig objects, Svelte takes the non-deferred
  // code path which uses safe no-op handlers.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function send(node: Element, _params: { key: any }) {
    return scale(node, { duration: 150, start: 0.97, easing: quintOut });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function receive(node: Element, _params: { key: any }) {
    return scale(node, { duration: 150, start: 0.97, easing: quintOut });
  }
</script>

<script lang="ts">
  import { cn } from '$lib/utils';
  import Fa from 'svelte-fa';
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import LineChangesBadge from '$lib/components/shared/LineChangesBadge.svelte';
  import Tooltip from './tooltip/Tooltip.svelte';

  interface Tab {
    id: string;
    label?: string;
    icon?: IconDefinition;
    iconOnly?: boolean;
    class?: string;
    badge?: {
      additions: number;
      deletions: number;
    };
  }

  interface Props {
    tabs: Tab[];
    activeTab: string;
    /** Optional: tab ID that has related focused content in panels (shows ring indicator) */
    focusedTabId?: string | null;
    onTabChange?: (tabId: string) => void;
    hideBadges?: boolean;
    hideLabels?: boolean;
    class?: string;
  }

  let {
    tabs,
    activeTab,
    focusedTabId,
    onTabChange,
    hideBadges = false,
    hideLabels = false,
    class: className,
  }: Props = $props();

  function handleTabClick(tabId: string) {
    onTabChange?.(tabId);
  }
</script>

<div class={cn('flex items-center gap-1 relative', className)}>
  {#each tabs as tab (tab.id)}
    {@const isActive = activeTab === tab.id}
    {@const isFocused = focusedTabId === tab.id && !isActive}
    <Tooltip
      content={tab.iconOnly ? tab.label : undefined}
      side="top"
      delayDuration={0}
      class={cn(tab.class || '')}
    >
      <button
        type="button"
        class={cn(
          'relative flex items-center justify-center gap-1.5 h-7 py-1.5 px-2.5 -mx-0.5 text-xs font-medium transition-all duration-150 cursor-pointer shrink-0',
          tab.class || '',
          isActive ? '' : 'text-muted-foreground hover:text-foreground',
          isFocused && 'ring-1 ring-primary/40 rounded',
        )}
        onclick={() => handleTabClick(tab.id)}
        title={tab.iconOnly ? tab.label : undefined}
      >
        {#if tab.icon}
          <Fa
            icon={tab.icon}
            size={tab.iconOnly ? 16 : 'xs'}
            class={cn('opacity-60', isFocused && (tab.iconOnly ? 'opacity-100' : 'opacity-80'))}
          />
        {/if}
        {#if !hideLabels && !tab.iconOnly && tab.label}
          <span>{tab.label}</span>
        {/if}
        {#if !hideBadges && tab.badge && (tab.badge.additions > 0 || tab.badge.deletions > 0)}
          <LineChangesBadge
            additions={tab.badge.additions}
            deletions={tab.badge.deletions}
            size="xxs"
            class="ml-1"
            animated
          />
        {/if}
        {#if isActive}
          <div
            class="absolute bottom-0 inset-x-0 bg-foreground/80 top-auto h-[1.5px] z-10"
            aria-hidden="true"
            in:receive={{ key: 'tab-indicator' }}
            out:send={{ key: 'tab-indicator' }}
          ></div>
        {/if}
      </button>
    </Tooltip>
  {/each}
  <div class="absolute inset-x-0 bottom-0 border-b border-border"></div>
</div>
