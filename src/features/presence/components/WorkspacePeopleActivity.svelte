<script lang="ts">
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import { ListRow, ListView } from '$lib/components/patterns/collection';
  import { EmptyState, ErrorState, LoadingState } from '$lib/components/patterns/screen';
  import { Button } from '$lib/components/ui/button';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { selectWorkspacePeopleIdentities } from '$store/renderer/slices/presence/presence-selectors';
  import {
    selectWorkspaceEvents,
    selectPeopleEventsLoading,
    selectPeopleEventsError,
    selectPeopleEventsInitialized,
    selectOlderEventsNextToken,
    selectOlderEventsEndReached,
  } from '$store/renderer/slices/workspace-events/workspace-events-selectors';
  import { loadPeopleEventsRequested } from '$store/renderer/slices/workspace-events/workspace-events-slice';
  import {
    getPanelTabOpenState,
    selectFocusedPanelId,
    selectPanel,
    selectPanelIds,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import { openTab, setActiveTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { ensureAgentSessionLoaded } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { markNoteRead } from '$store/renderer/slices/note-read-tracking/note-read-tracking-slice';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { normalizeActivityFilePath } from '$lib/components/workspace/utils/activity-file-path';
  import { openMessage } from '$lib/utils/open-message';
  import { getPeopleActivity, type PeopleActivityRow } from './people-activity';

  let {
    workspaceId,
    panelLayoutId = workspaceId,
  }: { workspaceId: string; panelLayoutId?: string } = $props();
  const workspaceIdStore = writable('');
  $effect(() => workspaceIdStore.set(workspaceId));
  const events$ = selectWorkspaceEvents(workspaceIdStore);
  const people$ = selectWorkspacePeopleIdentities(workspaceIdStore);
  const workspace$ = selectWorkspaceById(workspaceIdStore);
  const loading$ = selectPeopleEventsLoading(workspaceIdStore);
  const nextToken$ = selectOlderEventsNextToken(workspaceIdStore);
  const endReached$ = selectOlderEventsEndReached(workspaceIdStore);
  const error$ = selectPeopleEventsError(workspaceIdStore);
  const initialized$ = selectPeopleEventsInitialized(workspaceIdStore);
  const rows = $derived(
    getPeopleActivity(workspaceId, $events$, $people$, $workspace$?.ownerPrincipalId),
  );
  const pendingInitial = $derived(!$initialized$ && !$endReached$ && !$nextToken$ && !$error$);
  let messageNavigation: AbortController | undefined;

  $effect(() => {
    void workspaceId;
    return () => messageNavigation?.abort();
  });

  function openActivity(item: PeopleActivityRow) {
    messageNavigation?.abort();
    if (!item.destination) return;
    const panelId =
      selectFocusedPanelId.select(appStore.state, panelLayoutId) ??
      selectPanelIds.select(appStore.state, panelLayoutId)[0];
    if (!panelId) return;
    const panel = selectPanel.select(appStore.state, panelLayoutId, panelId);
    if (!panel) return;
    const destination = { ...item.destination };
    if (destination.filePath) {
      destination.filePath = normalizeActivityFilePath(
        destination.filePath,
        selectWorkspaceById.select(appStore.state, workspaceId),
      );
    }
    const existing = panel.tabs.find(
      (tab) => getPanelTabOpenState([tab], null, workspaceId, destination).isOpen,
    );
    if (destination.agentId) {
      appStore.dispatch(ensureAgentSessionLoaded(workspaceId, destination.agentId));
    }
    if (destination.noteId) appStore.dispatch(markNoteRead(workspaceId, destination.noteId));
    appStore.dispatch(
      existing
        ? setActiveTab(panelLayoutId, existing.id, panelId)
        : openTab(panelLayoutId, destination, panelId, undefined, true, undefined, true),
    );
    const targetTabId = selectPanel.select(appStore.state, panelLayoutId, panelId)?.activeTabId;
    if (item.messageId && destination.agentId && targetTabId) {
      messageNavigation = new AbortController();
      void openMessage({
        workspaceId,
        agentId: destination.agentId,
        messageId: item.messageId,
        contentAlreadyOpen: true,
        targetTabId,
        signal: messageNavigation.signal,
      });
    }
  }

  $effect(() => {
    const id = workspaceId;
    if ($initialized$ || $loading$) return;
    untrack(() => {
      if (id) appStore.dispatch(loadPeopleEventsRequested(id, 'initial'));
    });
  });
</script>

<div class="min-w-0" data-people-activity>
  <h3
    class="px-2.5 py-1.5 text-[11px] leading-4 text-muted-foreground /* a11y-ignore: Figma People activity uses 11px compact text */"
  >
    {m.workspace_resizablePanels_activity_label()}
  </h3>

  {#if rows.length > 0}
    <ListView
      items={rows}
      getKey={(row) => row.id}
      getText={(row) => row.label}
      onActivate={openActivity}
      ariaLabel={m.workspace_resizablePanels_activity_label()}
      virtualize={false}
      class="overflow-visible"
    >
      {#snippet row({ item })}
        <ListRow
          data-people-activity-id={item.id}
          data-message-preview={item.messagePreview ? true : undefined}
          class="min-h-[42px] items-center gap-2.5 px-2.5 py-1.5 [&_[data-slot=list-row-title]]:whitespace-normal [&_[data-slot=list-row-title]]:break-words [&_[data-slot=list-row-title]]:[overflow-wrap:anywhere] [&_[data-slot=list-row-title]]:text-[11px] [&_[data-slot=list-row-title]]:leading-4 [&_[data-slot=list-row-leading]]:h-auto [&_[data-slot=list-row-leading]]:self-center [&_[data-slot=list-row-trailing]]:h-auto [&_[data-slot=list-row-trailing]]:self-center [&_[data-slot=list-row-trailing]]:text-[11px] [&_[data-slot=list-row-trailing]]:leading-4 /* a11y-ignore: Figma People activity uses 11px compact text */"
        >
          {#snippet leading()}
            <PrincipalAvatar
              label={item.name}
              avatarUrl={item.avatarUrl}
              size={30}
              class="border border-border"
            />
          {/snippet}
          {#snippet title()}
            <span class={item.messagePreview ? 'block truncate' : undefined}>{item.label}</span>
          {/snippet}
          {#snippet trailing()}
            <RelativeTime
              date={item.timestamp}
              compact
              class="whitespace-nowrap text-[11px] leading-4 text-muted-foreground /* a11y-ignore: Figma People activity uses 11px compact text */"
            />
          {/snippet}
        </ListRow>
      {/snippet}
    </ListView>
  {/if}

  {#if $error$ && rows.length === 0}
    <ErrorState
      density="compact"
      retryLabel={m.workspace_activityPanel_retryOlder_label()}
      onRetry={() => appStore.dispatch(loadPeopleEventsRequested(workspaceId, 'initial', true))}
    >
      {#snippet message()}{m.workspace_peopleActivity_load_error()}{/snippet}
    </ErrorState>
  {:else if rows.length === 0 && ($loading$ || pendingInitial)}
    <LoadingState density="compact" label={m.workspace_peopleActivity_loading_label()} count={3} />
  {:else if rows.length === 0}
    <EmptyState density="compact">
      {#snippet description()}
        {$endReached$
          ? m.workspace_peopleActivity_empty_label()
          : m.workspace_peopleActivity_recentEmpty_label()}
      {/snippet}
    </EmptyState>
  {/if}

  {#if (rows.length > 0 && ($loading$ || $error$)) || ($nextToken$ && !$endReached$ && !(rows.length === 0 && $error$))}
    <div class="flex flex-col items-start gap-1 py-2">
      {#if $error$}
        <p class="type-caption text-muted-foreground" role="status">
          {m.workspace_peopleActivity_loadOlder_error()}
        </p>
      {/if}
      <Button
        variant="ghost"
        size="sm"
        class="px-2.5 text-muted-foreground hover:text-foreground"
        loading={$loading$}
        onclick={() =>
          appStore.dispatch(
            loadPeopleEventsRequested(workspaceId, $nextToken$ ? 'more' : 'initial', true),
          )}
      >
        {$loading$
          ? m.workspace_activityPanel_loadingOlder_label()
          : $error$
            ? m.workspace_activityPanel_retryOlder_label()
            : m.workspace_peopleActivity_loadMore_label()}
      </Button>
    </div>
  {/if}
</div>
