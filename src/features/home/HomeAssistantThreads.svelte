<script lang="ts">
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    faBoxArchive,
    faBoxOpen,
    faPlus,
    faTrash,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import { ListRow, ListView } from '$lib/components/patterns/collection';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { Separator } from '$lib/components/ui/separator';
  import SidebarContextMenu from '$lib/components/ui/sidebar-context-menu/SidebarContextMenu.svelte';
  import {
    getSidebarContextPosition,
    type SidebarContextPosition,
    type SidebarMenuEntry,
  } from '$lib/components/ui/sidebar-context-menu/types';
  import SidebarGroupHeader from '$lib/components/workspace/sidebar/SidebarGroupHeader.svelte';
  import { pinMenuItems } from '$lib/components/chat/agent-pin-menu';
  import {
    CHIEF_THREAD_RESOURCE_ID,
    createChiefThreadStarter,
  } from '$lib/components/layout/sidebar-nav/cards/chief-thread-starter.svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import { isCmdClickModifier } from '$shared/utils/link-helpers';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { setChiefActiveAgentId } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import {
    selectChiefActiveAgentId,
    selectChiefThreads,
    selectRetiredChiefThreads,
  } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import type { ChiefThreadSummary } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { selectHidesAgentLifecycleActions } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    agentRetirementSupportRequested,
    deleteAgentWithUndoRequested,
    deleteAgentsWithUndoRequested,
    fetchRetiredAgentsRequested,
    restoreRetiredAgentRequested,
    retireAgentsRequested,
    setActiveAgentId,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import {
    selectAgentCreationOutcome,
    selectAgentRetirementSupported,
    selectIsLoadingRetiredAgents,
    selectRetiredAgentsLoaded,
    selectRetiredCount,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import {
    backgroundHooksSubscribeRequested,
    backgroundHooksUnsubscribeRequested,
  } from '$store/renderer/slices/background-hooks/background-hooks-slice';
  import {
    prMonitorsSubscribeRequested,
    prMonitorsUnsubscribeRequested,
  } from '$store/renderer/slices/pr-monitor/pr-monitor-slice';
  import {
    scriptMonitorsSubscribeRequested,
    scriptMonitorsUnsubscribeRequested,
  } from '$store/renderer/slices/script-monitor/script-monitor-slice';
  import HomeAssistantThreadActivity from './HomeAssistantThreadActivity.svelte';

  const threads$ = selectChiefThreads();
  const retiredThreads$ = selectRetiredChiefThreads();
  const activeAgentId$ = selectChiefActiveAgentId();
  const hidesThreadActions$ = selectHidesAgentLifecycleActions(CHIEF_WORKSPACE_ID);
  const retirementSupported$ = selectAgentRetirementSupported();
  const retiredCount$ = selectRetiredCount(CHIEF_WORKSPACE_ID);
  const retiredLoaded$ = selectRetiredAgentsLoaded(CHIEF_WORKSPACE_ID);
  const loadingRetired$ = selectIsLoadingRetiredAgents(CHIEF_WORKSPACE_ID);
  const threadConsumerId = crypto.randomUUID();
  const threadStarter = createChiefThreadStarter(
    threadConsumerId,
    selectAgentCreationOutcome(threadConsumerId, CHIEF_WORKSPACE_ID, CHIEF_THREAD_RESOURCE_ID),
  );

  // Cmd/Ctrl-click builds a selection for bulk actions; without one, the open chat is selected.
  let multiKeys = $state<string[]>([]);
  let anchorKey: string | null = null;
  let showArchived = $state(false);
  let contextMenu = $state<(SidebarContextPosition & { agentId: string }) | null>(null);
  let archivingOpen = $state<{ agentId: string; archived: string[] } | null>(null);

  const liveIds = $derived(new Set($threads$.map((thread) => thread.agentId)));
  const selection = $derived(multiKeys.filter((key) => liveIds.has(key)));
  const openKeys = $derived($activeAgentId$ ? [$activeAgentId$] : []);
  // The daemon count stands in until the archived rows load; loaded rows then win.
  const archivedCount = $derived(
    $retiredLoaded$ ? $retiredThreads$.length : Math.max($retiredCount$, $retiredThreads$.length),
  );
  // The daemon refuses to retire the last live chat, so keep one out of every archive.
  const canArchive = (agentIds: readonly string[]) =>
    $retirementSupported$ && $threads$.some((thread) => !agentIds.includes(thread.agentId));

  onMount(() => {
    appStore.dispatch(backgroundHooksSubscribeRequested(CHIEF_WORKSPACE_ID));
    appStore.dispatch(prMonitorsSubscribeRequested(CHIEF_WORKSPACE_ID));
    appStore.dispatch(scriptMonitorsSubscribeRequested(CHIEF_WORKSPACE_ID));
    void appStore.dispatch(agentRetirementSupportRequested());
    return () => {
      appStore.dispatch(backgroundHooksUnsubscribeRequested(CHIEF_WORKSPACE_ID));
      appStore.dispatch(prMonitorsUnsubscribeRequested(CHIEF_WORKSPACE_ID));
      appStore.dispatch(scriptMonitorsUnsubscribeRequested(CHIEF_WORKSPACE_ID));
    };
  });

  function chooseThread(agentId: string) {
    multiKeys = [];
    appStore.dispatch(setChiefActiveAgentId(agentId));
    appStore.dispatch(setActiveAgentId(CHIEF_WORKSPACE_ID, agentId));
  }

  function startThread() {
    if (!$hidesThreadActions$) threadStarter.start();
  }

  function activateLive(
    thread: ChiefThreadSummary,
    index: number,
    event: MouseEvent | KeyboardEvent,
  ) {
    if ($hidesThreadActions$) return chooseThread(thread.agentId);
    if (isCmdClickModifier({ event })) {
      multiKeys = selection.includes(thread.agentId)
        ? selection.filter((key) => key !== thread.agentId)
        : [...selection, thread.agentId];
      anchorKey = thread.agentId;
      return;
    }
    const anchor = $threads$.findIndex((item) => item.agentId === (anchorKey ?? $activeAgentId$));
    if (event.shiftKey && anchor >= 0) {
      const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
      multiKeys = $threads$.slice(from, to + 1).map((item) => item.agentId);
      return;
    }
    anchorKey = thread.agentId;
    chooseThread(thread.agentId);
  }

  function closeMenu() {
    contextMenu = null;
  }

  function archive(agentIds: string[]) {
    closeMenu();
    if (!canArchive(agentIds)) return;
    multiKeys = [];
    archivingOpen =
      $activeAgentId$ && agentIds.includes($activeAgentId$)
        ? { agentId: $activeAgentId$, archived: agentIds }
        : null;
    appStore.dispatch(retireAgentsRequested(CHIEF_WORKSPACE_ID, agentIds));
  }

  // Once the open chat is actually archived, move to the next live chat instead of
  // leaving a read-only transcript open; a refused archive leaves the chat in place.
  $effect(() => {
    const pending = archivingOpen;
    if (!pending) return;
    if ($activeAgentId$ !== pending.agentId) {
      archivingOpen = null;
      return;
    }
    if (!$retiredThreads$.some((thread) => thread.agentId === pending.agentId)) return;
    archivingOpen = null;
    const next = $threads$.find((thread) => !pending.archived.includes(thread.agentId));
    if (next) chooseThread(next.agentId);
  });

  function remove(threads: ChiefThreadSummary[]) {
    closeMenu();
    multiKeys = [];
    if (threads.length === 1) {
      const [thread] = threads;
      appStore.dispatch(
        deleteAgentWithUndoRequested(CHIEF_WORKSPACE_ID, thread.agentId, thread.title),
      );
    } else if (threads.length > 1) {
      appStore.dispatch(
        deleteAgentsWithUndoRequested(
          CHIEF_WORKSPACE_ID,
          threads.map((thread) => ({ agentId: thread.agentId, name: thread.title })),
        ),
      );
    }
  }

  function selectedThreads(): ChiefThreadSummary[] {
    return $threads$.filter((thread) => selection.includes(thread.agentId));
  }

  function openMenu(event: MouseEvent | KeyboardEvent) {
    if ($hidesThreadActions$) return;
    const option = (event.target as Element | null)?.closest<HTMLElement>('[role="option"]');
    const agentId =
      option?.querySelector<HTMLElement>('[data-assistant-thread]')?.dataset.assistantThread;
    if (!option || !agentId) return;
    const position = getSidebarContextPosition(event);
    if (!position) return;
    const bounds = option.getBoundingClientRect();
    const keyboard = event instanceof KeyboardEvent;
    if (!selection.includes(agentId)) multiKeys = [];
    contextMenu = {
      x: keyboard ? bounds.left : position.x,
      y: keyboard ? bounds.bottom : position.y,
      returnFocus: option,
      agentId,
    };
    void appStore.dispatch(agentRetirementSupportRequested());
  }

  function handleListKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && selection.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      multiKeys = [];
      return;
    }
    openMenu(event);
  }

  function menuItems(agentId: string): SidebarMenuEntry[] {
    const bulk = selection.length > 1 && selection.includes(agentId);
    if (bulk) {
      const threads = selectedThreads();
      const count = formatInteger(threads.length);
      return [
        ...($retirementSupported$
          ? [
              {
                id: 'archive',
                label: m.home_assistantThread_archiveMany_label({ count }),
                icon: faBoxArchive,
                disabled: !canArchive(selection),
                disabledReason: canArchive(selection)
                  ? undefined
                  : m.home_assistantThread_keepOne_reason(),
                onClick: () => archive(threads.map((thread) => thread.agentId)),
              },
            ]
          : []),
        {
          id: 'delete',
          label: m.home_assistantThread_deleteMany_label({ count }),
          icon: faTrash,
          destructive: true,
          onClick: () => remove(threads),
        },
      ];
    }
    const thread =
      $threads$.find((item) => item.agentId === agentId) ??
      $retiredThreads$.find((item) => item.agentId === agentId);
    if (!thread) return [];
    const items: SidebarMenuEntry[] = [];
    if (thread.retired) {
      items.push({
        id: 'unarchive',
        label: m.home_assistantThread_unarchive_label(),
        icon: faBoxOpen,
        onClick: () => {
          closeMenu();
          appStore.dispatch(restoreRetiredAgentRequested(CHIEF_WORKSPACE_ID, agentId));
        },
      });
    } else {
      const pin = pinMenuItems(
        selectAgentSession.select(appStore.state, agentId),
        CHIEF_WORKSPACE_ID,
        closeMenu,
      );
      if (pin.length > 0) items.push(...pin, { type: 'separator' });
      if ($retirementSupported$) {
        items.push({
          id: 'archive',
          label: m.home_assistantThread_archive_label(),
          icon: faBoxArchive,
          disabled: !canArchive([agentId]),
          disabledReason: canArchive([agentId])
            ? undefined
            : m.home_assistantThread_keepOne_reason(),
          onClick: () => archive([agentId]),
        });
      }
    }
    items.push({
      id: 'delete',
      label: m.chat_agentCard_menu_delete_label(),
      icon: faTrash,
      destructive: true,
      onClick: () => remove([thread]),
    });
    return items;
  }

  function toggleArchived() {
    showArchived = !showArchived;
    if (showArchived && !$retiredLoaded$ && !$loadingRetired$)
      appStore.dispatch(fetchRetiredAgentsRequested(CHIEF_WORKSPACE_ID));
  }
</script>

{#if selection.length > 0}
  <div
    role="toolbar"
    aria-label={m.home_assistantThread_selected_label({ count: formatInteger(selection.length) })}
    class="mb-1 flex h-9 shrink-0 items-center gap-1 pr-1 pl-0.5"
  >
    <Button
      variant="ghost"
      size="icon-compact"
      aria-label={m.home_assistantThread_clearSelection_label()}
      title={m.home_assistantThread_clearSelection_label()}
      onclick={() => (multiKeys = [])}
    >
      <Fa icon={faXmark} size="xs" />
    </Button>
    <span class="min-w-0 flex-1 truncate type-caption text-muted-foreground" aria-hidden="true">
      {m.home_assistantThread_selected_label({ count: formatInteger(selection.length) })}
    </span>
    {#if $retirementSupported$}
      <Button
        variant="ghost"
        size="icon-compact"
        aria-label={m.home_assistantThread_archive_label()}
        title={canArchive(selection)
          ? m.home_assistantThread_archive_label()
          : m.home_assistantThread_keepOne_reason()}
        disabled={!canArchive(selection)}
        onclick={() => archive(selection)}
      >
        <Fa icon={faBoxArchive} size="xs" />
      </Button>
    {/if}
    <Button
      variant="ghost"
      size="icon-compact"
      aria-label={m.chat_agentCard_menu_delete_label()}
      title={m.chat_agentCard_menu_delete_label()}
      onclick={() => remove(selectedThreads())}
    >
      <Fa icon={faTrash} size="xs" />
    </Button>
  </div>
{:else if !$hidesThreadActions$}
  <Button
    variant="ghost"
    class="mb-1 h-9 w-full shrink-0 justify-start gap-2 px-2 text-muted-foreground hover:text-foreground focus-visible:-outline-offset-1"
    labelClass="text-left font-normal"
    aria-disabled={threadStarter.pending || undefined}
    aria-busy={threadStarter.pending || undefined}
    onclick={startThread}
  >
    {#snippet leadingIcon()}
      <span class="flex size-3 items-center justify-center [&_svg]:size-3" aria-hidden="true">
        {#if threadStarter.pending}
          <IntentMarkLoader size={12} />
        {:else}
          <Fa icon={faPlus} />
        {/if}
      </span>
    {/snippet}
    {m.home_new_chat()}
  </Button>
{/if}

{#snippet threadRow(thread: ChiefThreadSummary, dividerBefore: boolean)}
  <ListRow
    class="min-h-9 px-2 py-2"
    role="group"
    aria-label={thread.title}
    data-assistant-thread={thread.agentId}
  >
    {#snippet title()}
      {#if dividerBefore}
        <!-- Pinned chats sit above this line; drawn inside the row to keep uniform row heights. -->
        <div class="pointer-events-none absolute inset-x-2 top-0" data-assistant-pinned-divider>
          <Separator decorative />
        </div>
      {/if}
      <span title={thread.title}>{thread.title}</span>
    {/snippet}
    {#snippet trailing()}
      {#if !thread.retired}<HomeAssistantThreadActivity agentId={thread.agentId} />{/if}
      {#if thread.isActive}
        <span
          class="size-1.5 shrink-0 rounded-full bg-primary"
          role="img"
          aria-label={m.layout_chiefCard_activeThread_ariaLabel()}
        ></span>
      {/if}
      {#if !$hidesThreadActions$}
        <!-- Collapsed until the row is hovered or focused, so it never covers the activity badges. -->
        <span
          class="-my-1 flex w-0 shrink-0 justify-end overflow-hidden opacity-0 transition-[width,opacity] group-focus-within/collection-row:w-6 group-focus-within/collection-row:opacity-100 group-hover/collection-row:w-6 group-hover/collection-row:opacity-100"
        >
          <Button
            variant="ghost"
            size="icon-compact"
            class="shrink-0"
            aria-label={m.layout_chiefCard_deleteThread_ariaLabel({ title: thread.title })}
            title={m.layout_chiefCard_deleteThread_tooltip()}
            onclick={() => remove([thread])}
          >
            <Fa icon={faTrash} size="xs" />
          </Button>
        </span>
      {/if}
    {/snippet}
  </ListRow>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions (delegates the rows' context menu and Escape) -->
<div class="flex min-h-0 flex-1 flex-col" oncontextmenu={openMenu} onkeydown={handleListKeydown}>
  <ListView
    items={$threads$}
    getKey={(thread) => thread.agentId}
    getText={(thread) => thread.title}
    selectable="multi"
    selectedKeys={selection.length > 0 ? selection : openKeys}
    onActivate={activateLive}
    ariaLabel={m.layout_chiefCard_threadPicker_ariaLabel()}
    virtualize
    rowHeight={36}
    class="min-h-0 flex-1"
  >
    {#snippet row({ item: thread, index })}
      {@render threadRow(
        thread,
        index > 0 && !thread.pinned && $threads$[index - 1]?.pinned === true,
      )}
    {/snippet}
    {#snippet empty()}
      <p role="status" class="min-h-0 flex-1 px-2 py-3 type-caption text-muted-foreground">
        {m.layout_chiefCard_noThreads_label()}
      </p>
    {/snippet}
  </ListView>

  {#if archivedCount > 0}
    <div class="shrink-0 pt-1">
      <SidebarGroupHeader
        title={m.home_assistantThread_archived_label()}
        meta={formatInteger(archivedCount)}
        label={archivedCount === 1
          ? m.home_assistantThread_archivedCount_one({ count: formatInteger(archivedCount) })
          : m.home_assistantThread_archivedCount_many({ count: formatInteger(archivedCount) })}
        expanded={showArchived}
        onclick={toggleArchived}
        data-assistant-archived-toggle=""
      />
    </div>
    {#if showArchived}
      <ListView
        items={$retiredThreads$}
        getKey={(thread) => thread.agentId}
        getText={(thread) => thread.title}
        selectable="single"
        selectedKeys={selection.length > 0 ? [] : openKeys}
        onActivate={(thread) => chooseThread(thread.agentId)}
        status={$retiredThreads$.length === 0 && !$retiredLoaded$ ? 'loading' : 'ready'}
        ariaLabel={m.home_assistantThread_archivedList_label()}
        virtualize="auto"
        rowHeight={36}
        class="max-h-[40%] min-h-0 shrink-0"
      >
        {#snippet row({ item: thread })}
          {@render threadRow(thread, false)}
        {/snippet}
      </ListView>
    {/if}
  {/if}
</div>

{#if contextMenu}
  <SidebarContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    returnFocus={contextMenu.returnFocus}
    items={menuItems(contextMenu.agentId)}
    onClickOutside={closeMenu}
  />
{/if}
