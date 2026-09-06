<script lang="ts" module>
  import { definePreview } from './preview-definition';

  interface BrowserTabsMenuPreviewProps {
    count: number;
    width: number;
  }

  export const preview = definePreview<BrowserTabsMenuPreviewProps>({
    id: 'browser-tabs-menu',
    title: 'Browser tabs in an agent header',
    defaultState: 'five-tabs',
    states: {
      'one-tab': { props: { count: 1, width: 860 } },
      'three-tabs': { props: { count: 3, width: 860 } },
      'five-tabs': { props: { count: 5, width: 860 } },
    },
  });
</script>

<script lang="ts">
  import Fa from 'svelte-fa';
  import { faPlus, faRobot, faXmark } from '@fortawesome/free-solid-svg-icons';
  import BrowserTabsMenu from '$lib/components/chat/BrowserTabsMenu.svelte';
  import ChatMessageNavigator from '$lib/components/chat/ChatMessageNavigator.svelte';
  import type { BrowserTabEntry } from '$lib/components/chat/browser-tab-entries';
  import KebabIcon from '$lib/components/icons/KebabIcon.svelte';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';

  let { count, width }: BrowserTabsMenuPreviewProps = $props();
  const workspaceId = 'browser-tabs-menu-preview';
  const agentId = 'browser-tabs-menu-agent';
  const labels = ['Intent docs', 'Dashboard', 'Pull request', 'Long reference page', 'Preview'];
  const navigationMessages = [
    { id: 'message-1', text: 'Review the browser tabs in the agent header' },
    { id: 'message-2', text: 'Confirm the hidden tab presentation' },
  ];

  function buildEntries(entryCount: number): BrowserTabEntry[] {
    return labels.slice(0, entryCount).map((title, index) => {
      const hidden = entryCount > 1 && index === entryCount - 1;
      return {
        tab: {
          id: `browser-preview-${index}`,
          type: 'browser',
          title,
          browserUrl: `https://preview-${index}.example.test/`,
          ownerAgentId: agentId,
          closable: true,
        },
        ...(hidden ? {} : { panelId: 'browser-preview-panel' }),
        active: index === 0,
        hidden,
      };
    });
  }

  const entries = $derived(buildEntries(count));
</script>

<section
  class="overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm"
  style:width={`${width}px`}
  data-browser-tabs-menu-preview
  data-preview-count={count}
>
  <div
    class="flex h-[var(--panel-header-height)] min-w-0 items-center bg-card pr-2.5"
    data-panel-content-header
    data-panel-id="browser-tabs-menu-preview-panel"
    data-panel-header-preview
  >
    <div class="flex min-w-0 shrink items-center gap-2 overflow-hidden bg-card pl-1">
      <span
        class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <Fa icon={faRobot} size={12} />
      </span>
      <span class="block max-w-60 truncate text-sm font-medium text-foreground">
        Component catalog agent
      </span>
    </div>

    <div class="min-w-0 flex-1" aria-hidden="true"></div>

    <div class="flex shrink-0 items-center gap-0" data-panel-header-actions>
      <span class="flex min-w-0 items-center" data-panel-header-content-actions>
        <span class="flex min-w-0 items-center gap-1.5">
          <BrowserTabsMenu {workspaceId} {agentId} {entries} />
          <ChatMessageNavigator
            messages={navigationMessages}
            isAtBottom
            onSelectMessage={() => true}
            onScrollToBottom={() => {}}
          />
        </span>
      </span>
      <Button
        variant="ghost-light"
        size="icon-sm"
        aria-label={m.ui_breadcrumb_more_label()}
        data-testid="panel-actions-trigger"
      >
        <KebabIcon class="pointer-events-none size-3.5!" />
      </Button>
      <span class="mx-1 h-4 border-l border-border" aria-hidden="true"></span>
      <Button
        variant="plain"
        size="icon-sm"
        iconOnly
        class="relative flex size-7 shrink-0 items-center justify-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground shadow-none"
        aria-label={m.layout_panelTabBar_paneSelector_ariaLabel({ count: 2 })}
        data-testid="pane-stack-selector-trigger"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M2.25 5.25h9.5M2.25 8.75h9.5" stroke="currentColor" stroke-width="1.25" />
        </svg>
      </Button>
      <Button
        variant="ghost-light"
        size="icon-sm"
        aria-label={m.workspace_sidebarHeader_panelColumns_add_ariaLabel()}
        data-add-panel-column
      >
        <Fa icon={faPlus} size="xs" />
      </Button>
      <Button
        variant="ghost-light"
        size="icon-sm"
        aria-label={m.layout_panelTabBar_closePane_ariaLabel()}
        data-testid="panel-close-button"
      >
        <Fa icon={faXmark} size={14} class="size-3.5!" />
      </Button>
    </div>
  </div>
  <div class="h-20 border-t border-border bg-background/70"></div>
</section>
