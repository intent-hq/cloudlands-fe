<script lang="ts">
  import type { WorkspaceTabStatus } from '$store/renderer/slices/hud/hud-types';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { Button } from '$lib/components/ui/button';

  let {
    workspaceId,
    title,
    status,
    panelTabCount,
    sidebarWidth,
    onCloseWorkspace,
  }: {
    workspaceId: string;
    title: string;
    status?: WorkspaceTabStatus;
    panelTabCount: number;
    sidebarWidth: number;
    onCloseWorkspace: (event: MouseEvent) => void;
  } = $props();

  function statusClass(category: WorkspaceTabStatus['visibleCategories'][number]['category']) {
    switch (category) {
      case 'failed':
      case 'blocker':
        return 'bg-destructive';
      case 'question':
      case 'needs_input':
      case 'discussion':
      case 'review':
        return 'bg-warning';
      case 'unread':
        return 'bg-info';
      case 'running':
        return 'bg-success';
    }
  }
</script>

<div class="flex h-full min-h-0 w-full" data-workspace-surface-placeholder={workspaceId}>
  <div
    class="flex h-full min-h-0 shrink-0 flex-col border-r border-border/60 bg-sidebar"
    style:width={`${sidebarWidth}px`}
  >
    <header
      class="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3"
      data-workspace-title-region
      draggable="true"
    >
      <span class="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{title}</span>
      {#if status}
        {@const visibleStatus = status.visibleCategories[0]}
        <span class="flex shrink-0 items-center gap-1" aria-hidden="true">
          {#if visibleStatus}
            <span
              class="size-1.5 rounded-full {statusClass(visibleStatus.category)}"
              data-workspace-placeholder-status={visibleStatus.category}
              data-status-count={visibleStatus.count}
            ></span>
          {/if}
        </span>
      {/if}
      {#if panelTabCount > 0}
        <span
          class="shrink-0 text-xs tabular-nums text-muted-foreground"
          data-workspace-placeholder-panel-count={panelTabCount}
          aria-hidden="true">{formatInteger(panelTabCount)}</span
        >
      {/if}
      <Button
        variant="ghost"
        size="icon-xs"
        class="flex size-5 shrink-0 items-center justify-center rounded text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={m.layout_workspaceTabStrip_close_ariaLabel({ name: title })}
        data-workspace-close
        onpointerdown={(event) => event.stopPropagation()}
        onclick={onCloseWorkspace}>×</Button
      >
    </header>
    <div class="min-h-0 flex-1 bg-sidebar/70" aria-hidden="true"></div>
  </div>
  <div class="min-w-0 flex-1 bg-background/35" aria-hidden="true"></div>
</div>
