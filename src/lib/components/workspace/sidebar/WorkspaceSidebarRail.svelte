<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import Fa from 'svelte-fa';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import IntentNavigationIcon from '$lib/icons/IntentNavigationIcon.svelte';
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

  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let keyboardOpen = false;
  let railElement: HTMLElement;

  function cancelClose() {
    clearTimeout(closeTimer);
  }

  function scheduleClose() {
    cancelClose();
    if (keyboardOpen) return;
    closeTimer = setTimeout(() => (activeTab = null), 250);
  }

  onDestroy(cancelClose);
</script>

<nav
  bind:this={railElement}
  class="flex h-full flex-col items-center gap-1 border-r border-border py-3"
  aria-label={m.workspace_layout_ariaLabel()}
  data-workspace-sidebar-rail
>
  <Button
    variant="ghost"
    size="icon"
    iconOnly
    aria-label={m.layout_titleBar_toggleSidebar_ariaLabel()}
    title={m.layout_titleBar_toggleSidebar_ariaLabel()}
    onclick={onExpand}
    data-sidebar-rail-expand
  >
    <IntentNavigationIcon name="sidebar" size={16} />
  </Button>
  {#each tabs as tab (tab.id)}
    <Popover.Root
      open={activeTab === tab.id}
      onOpenChange={(open) => {
        cancelClose();
        if (open) activeTab = tab.id;
        else if (activeTab === tab.id) activeTab = null;
      }}
    >
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost"
            size="icon"
            iconOnly
            class={tab.id === 'overview' ? 'mb-3' : ''}
            aria-label={tab.label}
            data-sidebar-rail-tab={tab.id}
            onpointerenter={(event) => {
              if (event.pointerType !== 'mouse') return;
              cancelClose();
              keyboardOpen = false;
              activeTab = tab.id;
            }}
            onpointerleave={scheduleClose}
            onclick={() => {
              cancelClose();
              keyboardOpen = true;
              activeTab = tab.id;
            }}
            onkeydown={() => {
              keyboardOpen = true;
              cancelClose();
            }}
          >
            <Fa icon={tab.icon} class="size-4" />
          </Button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content
        side="right"
        align="start"
        sideOffset={8}
        trapFocus={false}
        preventScroll={false}
        class="h-[min(640px,calc(100dvh-32px))] w-[min(360px,calc(100vw-72px))] p-0"
        aria-label={tab.label}
        data-sidebar-rail-preview={tab.id}
        onpointerenter={cancelClose}
        onpointerleave={scheduleClose}
        onfocusin={() => {
          keyboardOpen = true;
          cancelClose();
        }}
        onOpenAutoFocus={(event) => {
          if (!keyboardOpen) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (keyboardOpen && activeTab === null) {
            railElement
              ?.querySelector<HTMLButtonElement>(`[data-sidebar-rail-tab="${tab.id}"]`)
              ?.focus();
          }
        }}
        onInteractOutside={() => (keyboardOpen = false)}
      >
        {@render children()}
      </Popover.Content>
    </Popover.Root>
  {/each}
</nav>
