<script lang="ts">
  import type { WorkspaceEvent } from '$features/events/types';
  import {
    getActivityTitle,
    getActivityIcon,
    getEventAgentId,
    shouldShowActivityPreviewEvent,
  } from './utils';
  import { calculateCompactTime } from '$lib/utils/reactive-time.svelte';
  import { sharedTimeManager } from '$lib/utils/shared-time-manager.svelte';
  import { cn } from '$lib/utils';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { Button } from '$lib/components/ui/button';

  import Fa from 'svelte-fa';
  import { slide } from 'svelte/transition';
  import { faChevronDown, faChevronLeft, faPlus } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    events?: WorkspaceEvent[];
    scriptNames?: Readonly<Record<string, string>>;
    agentNames?: Readonly<Record<string, string>>;
    maxItems?: number;
    expandable?: boolean;
    /** File events (has data.path/filePath) — receives the full event for showing changes */
    onOpenFileEvent?: (event: WorkspaceEvent) => void;
    onShowAgent?: (agentId: string, event: WorkspaceEvent) => void;
    onOpenNote?: (noteId: string) => void;
    onViewAll?: () => void;
  }

  let {
    events = [],
    scriptNames = {},
    agentNames = {},
    maxItems = 2,
    expandable = true,
    onOpenFileEvent,
    onShowAgent,
    onOpenNote,
    onViewAll,
  }: Props = $props();

  let expanded = $state(false);

  // Tick that keeps compact time labels fresh via the shared time manager.
  let timeTick = $state(Date.now());

  interface ActivityRow {
    key: string;
    event: WorkspaceEvent;
    count: number;
  }

  // Deduplicate by ID, then group consecutive events with the same title into
  // one row (count badge) to reduce noise.
  const rows = $derived.by(() => {
    const seen = new Set<string>();
    const grouped: ActivityRow[] = [];
    let lastTitle: string | null = null;
    for (const event of events) {
      if (!event.id || !shouldShowActivityPreviewEvent(event) || seen.has(event.id)) continue;
      seen.add(event.id);
      const title = getActivityTitle(event, scriptNames, agentNames);
      const last = grouped[grouped.length - 1];
      if (last && title === lastTitle) {
        last.count += 1;
      } else {
        grouped.push({ key: event.id, event, count: 1 });
        lastTitle = title;
      }
    }
    return grouped;
  });

  $effect(() => {
    const newest = rows[0]?.event;
    if (!newest) return;
    const unsubscribe = sharedTimeManager.subscribe(new Date(newest.timestamp), () => {
      timeTick = Date.now();
    });
    return unsubscribe;
  });

  // Compact time labels; a row only shows its label when it differs from the
  // previous row's label.
  const rowTimes = $derived.by(() => {
    void timeTick;
    let lastLabel: string | null = null;
    return rows.map((row) => {
      const target = new Date(row.event.timestamp);
      const label = calculateCompactTime(target);
      const show = label !== lastLabel;
      lastLabel = label;
      return { label, show, full: target.toLocaleString() };
    });
  });

  const visibleRows = $derived(rows.slice(0, maxItems));
  const extraRows = $derived(rows.slice(maxItems));
  const hasMore = $derived(expandable && extraRows.length > 0);

  // --- Clickability (mirrors SidebarActivityPanel's handleEventClick) ---

  function getFilePath(event: WorkspaceEvent): string | null {
    if (!event.type.startsWith('file:')) return null;
    const data = event.data as Record<string, unknown> | undefined;
    return (data?.path || data?.filePath || null) as string | null;
  }

  function getNoteId(event: WorkspaceEvent): string | null {
    if (!event.type.startsWith('note:')) return null;
    const data = event.data as Record<string, unknown> | undefined;
    return (data?.noteId || data?.id || null) as string | null;
  }

  function getTaskNoteId(event: WorkspaceEvent): string | null {
    if (!event.type.startsWith('task:')) return null;
    const data = event.data as Record<string, unknown> | undefined;
    return (data?.noteId || data?.linkedNoteId || null) as string | null;
  }

  function isEventClickable(event: WorkspaceEvent): boolean {
    if (onOpenFileEvent && getFilePath(event)) return true;
    if (onShowAgent && getEventAgentId(event)) return true;
    if (onOpenNote && (getNoteId(event) || getTaskNoteId(event))) return true;
    return false;
  }

  // Row click opens the event's subject (file, then note/task). The agent is
  // reachable via its avatar, so it's only the row fallback when there's no
  // subject to open.
  function handleEventClick(event: WorkspaceEvent) {
    const filePath = getFilePath(event);
    if (filePath) {
      onOpenFileEvent?.(event);
      return;
    }
    const noteId = getNoteId(event) || getTaskNoteId(event);
    if (noteId) {
      onOpenNote?.(noteId);
      return;
    }
    const agentId = getEventAgentId(event);
    if (agentId) {
      onShowAgent?.(agentId, event);
    }
  }

  function handleAvatarClick(event: WorkspaceEvent) {
    const agentId = getEventAgentId(event);
    if (!onShowAgent || !agentId) return;
    onShowAgent(agentId, event);
  }
</script>

{#snippet activityRow(row: ActivityRow, index: number)}
  {@const icon = getActivityIcon(row.event)}
  {@const title = getActivityTitle(row.event, scriptNames, agentNames)}
  {@const time = rowTimes[index]}
  {@const clickable = isEventClickable(row.event)}
  {@const eventAgentId = getEventAgentId(row.event)}
  <div
    data-activity-preview-item
    class={cn(
      'group relative flex items-center gap-3 w-full text-left py-1 pl-0 pr-2 rounded-md outline-none',
      clickable ? 'cursor-pointer' : 'cursor-default',
    )}
    in:slide={{ duration: 200 }}
  >
    {#if eventAgentId && onShowAgent}
      <Button
        variant="plain"
        size="icon-xs"
        iconOnly
        class="bg-sidebar !h-auto !w-3.5 shrink-0 py-0.5"
        title={m.workspace_activityPreview_openAgent_ariaLabel()}
        aria-label={m.workspace_activityPreview_openAgent_ariaLabel()}
        onclick={() => handleAvatarClick(row.event)}
      >
        <AgentAvatar size={14} agentId={eventAgentId} />
      </Button>
    {:else if eventAgentId}
      <span class="bg-sidebar flex w-3.5 shrink-0 items-center justify-center py-0.5">
        <AgentAvatar size={14} agentId={eventAgentId} />
      </span>
    {:else}
      <div class="bg-sidebar py-0.5">
        <Fa
          {icon}
          size="xs"
          class="text-ghost shrink-0 w-3.5 opacity-50 transition-opacity group-hover:opacity-100"
        />
      </div>
    {/if}

    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onclick={() => handleEventClick(row.event)}
      disabled={!clickable}
    >
      <span
        class={cn(
          'text-ui-sm min-w-0 flex-1 truncate text-muted-foreground transition-colors',
          clickable && 'group-hover:text-foreground',
        )}
      >
        {title}
      </span>

      {#if time?.show}
        <span class="text-ui-sm text-subtle shrink-0" title={time.full}>
          {time.label}
        </span>
      {/if}
    </button>
  </div>
{/snippet}

{#if rows.length > 0 || onViewAll}
  <div class="flex min-h-0 flex-col">
    <div class="flex min-h-0 flex-col px-4 pt-0 pb-3">
      {#if rows.length > 0}
        <!-- Sleek timeline; scrolls when expanded. The negative right margin
             (offsetting this component's px-4 + the sidebar wrapper's px-2)
             pushes the scrollbar to the sidebar's right edge; the mask fades
             content out near the scroll edges. -->
        <div
          class={cn(
            'relative min-h-0 -mr-6 pr-6',
            expanded &&
              'overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_0.75rem,black_calc(100%-0.75rem),transparent)]',
          )}
        >
          <!-- Timeline line -->
          <div class="absolute left-1.5 top-2 -bottom-1.5 w-px bg-border"></div>

          <div class="space-y-0">
            {#each visibleRows as row, index (row.key)}
              {@render activityRow(row, index)}
            {/each}
          </div>
          {#if expanded && extraRows.length > 0}
            <div class="space-y-0" transition:slide={{ duration: 250 }}>
              {#each extraRows as row, index (row.key)}
                {@render activityRow(row, index + visibleRows.length)}
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if hasMore}
        <button
          type="button"
          class="shrink-0 w-full text-sm text-muted-foreground hover:text-foreground transition-colors mt-1.5 flex items-center gap-1 cursor-pointer outline-none"
          onclick={() => (expanded = !expanded)}
        >
          <Fa
            icon={expanded ? faChevronDown : faChevronLeft}
            size="xs"
            class="text-ghost shrink-0 w-3.5 mr-0.5"
          />
          <div class="flex-1 text-left text-ui-sm">
            {expanded
              ? m.workspace_activityPreview_showLess_label()
              : m.workspace_activityPreview_showMore_label()}
          </div>
        </button>
      {/if}

      {#if onViewAll}
        <button
          type="button"
          class="shrink-0 w-full text-sm text-muted-foreground hover:text-foreground transition-colors mt-1.5 flex items-center gap-1 cursor-pointer"
          onclick={() => onViewAll?.()}
        >
          <Fa icon={faPlus} size="xs" class="text-ghost shrink-0 w-3.5 mr-0.5" />
          <div class="flex-1 text-left text-ui">{m.workspace_activityPreview_seeAll_label()}</div>
        </button>
      {/if}
    </div>
  </div>
{/if}
