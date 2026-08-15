<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import './multi-select-sidebar-transitions.css';

  interface SidebarStripTab {
    id: string;
    label: string;
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

  $effect(() => {
    if (!tabs.some(({ id }) => id === hoveredTabId)) hoveredTabId = null;
    if (!tabs.some(({ id }) => id === focusedTabId)) focusedTabId = null;
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
  class="sidebar-expanded-tab-deck flex h-10 w-full min-w-0 overflow-hidden"
  data-sidebar-tab-strip
  data-launcher-layout="tabs"
  data-active-tab={activeTabId}
  data-preview-tab={previewedTabId ?? undefined}
>
  {#each tabs as tab, index (tab.id)}
    {@const active = tab.id === activeTabId}
    {@const expanded = tab.id === expandedTabId}
    {@const preview = tab.id === previewedTabId}
    {@const raised = tab.id === raisedTabId}
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
        class="sidebar-expanded-tab-action relative h-full w-full min-w-0 cursor-pointer justify-start gap-0! overflow-hidden rounded-none border border-border bg-card px-4! py-2 text-foreground opacity-100 outline-none hover:bg-muted focus-visible:bg-muted"
        onclick={() => onActivate(tab.id)}
        aria-expanded={expanded}
        aria-current={active ? 'page' : undefined}
        aria-label={active ? closeLabel : tab.label}
        data-tab-action={active ? 'close' : 'activate'}
        data-sidebar-card-surface
      >
        {#if expanded}
          <span
            class="min-w-0 truncate text-sm font-semibold {active ? 'pr-5' : ''}"
            data-sidebar-tab-strip-label
          >
            {tab.label}
          </span>
        {/if}
        {#if active}
          <span
            class="absolute right-4 cursor-pointer text-base leading-none {expanded
              ? ''
              : 'invisible'}"
            aria-hidden="true"
            data-sidebar-tab-close
            data-visible={expanded || undefined}>×</span
          >
        {/if}
      </Button>
    </div>
  {/each}
</div>
