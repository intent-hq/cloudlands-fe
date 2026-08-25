<script lang="ts">
  import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import './multi-select-sidebar-transitions.css';

  interface SidebarStripTab {
    id: string;
    label: string;
    icon: IconDefinition;
    unread?: boolean;
    unreadLabel?: string;
  }

  interface Props {
    tabs: SidebarStripTab[];
    activeTabId: string;
    closeLabel: string;
    onActivate: (tabId: string) => void;
  }

  let { tabs, activeTabId, closeLabel, onActivate }: Props = $props();
  let hoveredTabId = $state<string | null>(null);
  let focusedTabId = $state<string | null>(null);
  const raisedTabId = $derived(hoveredTabId ?? focusedTabId);
  const previewedTabId = $derived(raisedTabId === activeTabId ? null : raisedTabId);
  const expandedTabId = $derived(previewedTabId ?? activeTabId);
  const activeTabIndex = $derived(
    Math.max(
      0,
      tabs.findIndex(({ id }) => id === activeTabId),
    ),
  );
  let previousActiveTabIndex = $state(-1);
  let slideDirection = $state<'left' | 'right' | 'none'>('none');

  $effect(() => {
    if (!tabs.some(({ id }) => id === hoveredTabId)) hoveredTabId = null;
    if (!tabs.some(({ id }) => id === focusedTabId)) focusedTabId = null;
  });

  $effect(() => {
    if (previousActiveTabIndex >= 0 && previousActiveTabIndex !== activeTabIndex) {
      slideDirection = activeTabIndex > previousActiveTabIndex ? 'right' : 'left';
    }
    previousActiveTabIndex = activeTabIndex;
  });

  function handlePointerEnter(tabId: string) {
    hoveredTabId = tabId;
  }

  function handlePointerLeave(tabId: string) {
    if (hoveredTabId === tabId) hoveredTabId = null;
  }

  function handleFocusIn(tabId: string) {
    focusedTabId = tabId;
  }

  function handleFocusOut(event: FocusEvent, tabId: string) {
    const tab = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && tab.contains(event.relatedTarget)) return;
    if (focusedTabId === tabId) focusedTabId = null;
  }
</script>

<div
  class="sidebar-expanded-tab-deck mx-auto flex h-10 min-w-0 overflow-hidden"
  style={`--sidebar-tab-count: ${tabs.length}; --sidebar-active-index: ${activeTabIndex};`}
  data-sidebar-tab-strip
  data-launcher-layout="tabs"
  data-active-tab={activeTabId}
  data-preview-tab={previewedTabId ?? undefined}
  data-slide-direction={slideDirection}
>
  <span class="sidebar-expanded-tab-indicator" aria-hidden="true"></span>
  {#each tabs as tab, index (tab.id)}
    {@const active = tab.id === activeTabId}
    {@const expanded = tab.id === expandedTabId}
    {@const preview = tab.id === previewedTabId}
    {@const raised = tab.id === raisedTabId}
    {@const idleLabel = (tab.unread && tab.unreadLabel) || tab.label}
    <div
      role="group"
      class="sidebar-expanded-tab min-w-0 cursor-pointer"
      style={`--sidebar-tab-index: ${index};`}
      data-sidebar-collapsed-tab={tab.id}
      data-sidebar-launcher={tab.id}
      data-active={active || undefined}
      data-expanded={expanded || undefined}
      data-preview={preview || undefined}
      data-raised={raised || undefined}
      data-collapsed-tab-size={expanded ? 'expanded' : 'edge'}
      onpointerenter={() => handlePointerEnter(tab.id)}
      onpointerleave={() => handlePointerLeave(tab.id)}
      onfocusin={() => handleFocusIn(tab.id)}
      onfocusout={(event) => handleFocusOut(event, tab.id)}
    >
      <Button
        variant="plain"
        class="sidebar-expanded-tab-action relative h-full w-full min-w-0 cursor-pointer gap-0! overflow-hidden p-2! outline-none"
        onclick={(event) => {
          event.stopPropagation();
          onActivate(tab.id);
        }}
        aria-expanded={expanded}
        aria-current={active ? 'page' : undefined}
        aria-label={active ? closeLabel : idleLabel}
        tooltip={active ? closeLabel : idleLabel}
        tooltipDelayDuration={0}
        data-tab-action={active ? 'close' : 'activate'}
      >
        <span class="sidebar-expanded-tab-icon relative" data-sidebar-tab-strip-icon>
          <Fa icon={tab.icon} />
          {#if tab.unread}
            <span
              class="pointer-events-none absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-[hsl(var(--workspace-status-unread))] forced-colors:bg-[CanvasText]"
              data-sidebar-tab-unread-dot
              aria-hidden="true"
            ></span>
          {/if}
        </span>
        {#if active}
          <span class="sr-only" aria-hidden="true" data-sidebar-tab-close data-visible="true"
            >×</span
          >
        {/if}
      </Button>
    </div>
  {/each}
</div>
