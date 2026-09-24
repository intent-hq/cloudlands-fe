<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import IntentNavigationIcon from '$lib/icons/IntentNavigationIcon.svelte';
  import { animatedHeight, springIn } from '$lib/motion';
  import { m } from '$shared/paraglide/messages.js';
  import type { TabDefinition } from '../multi-select-sidebar-tabs';

  let {
    tabs,
    activeTab = $bindable<string | null>(null),
    onExpand,
    children,
  }: {
    tabs: TabDefinition[];
    activeTab?: string | null;
    onExpand: () => void;
    children: Snippet;
  } = $props();

  const previewId = $props.id();
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let keyboardOpen = false;
  let lastTab: string | null = null;
  let railElement = $state<HTMLElement>();
  const activeDefinition = $derived(tabs.find((tab) => tab.id === activeTab));

  function cancelClose() {
    clearTimeout(closeTimer);
  }

  function showTab(tabId: string, keyboard: boolean) {
    cancelClose();
    keyboardOpen = keyboard;
    lastTab = tabId;
    activeTab = tabId;
  }

  function scheduleClose() {
    cancelClose();
    if (keyboardOpen) return;
    closeTimer = setTimeout(() => (activeTab = null), 250);
  }

  onDestroy(cancelClose);
</script>

<Popover.Root
  open={activeTab !== null}
  onOpenChange={(open) => {
    if (!open) {
      cancelClose();
      activeTab = null;
    }
  }}
>
  <nav
    bind:this={railElement}
    class="flex h-full flex-col items-center gap-1 py-3"
    aria-label={m.workspace_layout_ariaLabel()}
    data-workspace-sidebar-rail
  >
    {#each tabs as tab (tab.id)}
      <Button
        variant="ghost"
        size="icon"
        iconOnly
        class={tab.id === 'overview' ? 'mb-3' : ''}
        aria-label={tab.id === 'overview' ? m.layout_titleBar_toggleSidebar_ariaLabel() : tab.label}
        title={tab.id === 'overview' ? m.layout_titleBar_toggleSidebar_ariaLabel() : undefined}
        aria-haspopup="dialog"
        aria-expanded={activeTab === tab.id}
        aria-controls={activeTab === tab.id ? previewId : undefined}
        data-sidebar-rail-expand={tab.id === 'overview' || undefined}
        data-sidebar-rail-tab={tab.id}
        onpointerenter={(event) => {
          if (event.pointerType === 'mouse') showTab(tab.id, false);
        }}
        onpointerleave={scheduleClose}
        onclick={() => {
          if (tab.id === 'overview') {
            cancelClose();
            onExpand();
          } else showTab(tab.id, true);
        }}
        onkeydown={(event) => {
          keyboardOpen = true;
          cancelClose();
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            showTab(tab.id, true);
          }
        }}
      >
        {#if tab.id === 'overview'}
          <IntentNavigationIcon name="sidebar" size={16} />
        {:else}
          <Fa icon={tab.icon} class="size-4" />
        {/if}
      </Button>
    {/each}
  </nav>
  <Popover.Content
    id={previewId}
    customAnchor={railElement}
    side="right"
    align="start"
    sideOffset={4}
    trapFocus={false}
    preventScroll={false}
    class="max-h-[min(640px,calc(100dvh-32px))] w-[min(360px,calc(100vw-72px))] overflow-y-auto p-0"
    aria-label={activeDefinition?.label}
    data-sidebar-rail-preview={activeTab}
    onpointerenter={cancelClose}
    onpointerleave={scheduleClose}
    onfocusin={() => {
      keyboardOpen = true;
      cancelClose();
    }}
    onOpenAutoFocus={(event) => event.preventDefault()}
    onCloseAutoFocus={(event) => {
      event.preventDefault();
      if (keyboardOpen && activeTab === null && lastTab) {
        railElement
          ?.querySelector<HTMLButtonElement>('[data-sidebar-rail-tab="' + lastTab + '"]')
          ?.focus();
      }
    }}
    onInteractOutside={() => (keyboardOpen = false)}
  >
    <div use:animatedHeight={{ tier: 'moderate' }}>
      {#key activeTab}
        <div in:springIn={{ tier: 'fast', x: -4 }}>
          {@render children()}
        </div>
      {/key}
    </div>
  </Popover.Content>
</Popover.Root>
