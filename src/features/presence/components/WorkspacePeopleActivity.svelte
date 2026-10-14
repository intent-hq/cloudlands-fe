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
  import { selectWorkspacePresencePeople } from '$store/renderer/slices/presence/presence-selectors';
  import {
    selectWorkspaceEvents,
    selectEventsLoading,
    selectOlderEventsLoading,
    selectOlderEventsNextToken,
    selectOlderEventsEndReached,
    selectOlderEventsError,
  } from '$store/renderer/slices/workspace-events/workspace-events-selectors';
  import {
    loadEventsRequested,
    loadOlderEventsRequested,
  } from '$store/renderer/slices/workspace-events/workspace-events-slice';
  import { getPeopleActivity } from './people-activity';

  let { workspaceId }: { workspaceId: string } = $props();
  const workspaceIdStore = writable('');
  $effect(() => workspaceIdStore.set(workspaceId));
  const events$ = selectWorkspaceEvents(workspaceIdStore);
  const people$ = selectWorkspacePresencePeople(workspaceIdStore);
  const loading$ = selectEventsLoading(workspaceIdStore);
  const loadingOlder$ = selectOlderEventsLoading(workspaceIdStore);
  const nextToken$ = selectOlderEventsNextToken(workspaceIdStore);
  const endReached$ = selectOlderEventsEndReached(workspaceIdStore);
  const olderError$ = selectOlderEventsError(workspaceIdStore);
  const error$ = appStore.createSelector<[string], string | null>(
    (state, id) => state.workspaceEvents.byWorkspaceId[id]?.error ?? null,
  )(workspaceIdStore);
  const rows = $derived(getPeopleActivity(workspaceId, $events$, $people$));
  const pendingInitial = $derived(!$endReached$ && !$nextToken$ && !$error$);

  $effect(() => {
    const id = workspaceId;
    untrack(() => {
      const history = appStore.state.workspaceEvents.byWorkspaceId[id];
      if (
        id &&
        !history?.loading &&
        !history?.loadingOlder &&
        !history?.error &&
        !history?.nextToken &&
        !history?.endReached
      ) {
        appStore.dispatch(loadEventsRequested(id));
      }
    });
  });
</script>

<div class="min-w-0" data-people-activity>
  <h3 class="px-2.5 py-1.5 text-[11px] leading-4 text-muted-foreground">
    {m.workspace_resizablePanels_activity_label()}
  </h3>

  {#if rows.length > 0}
    <ListView
      items={rows}
      getKey={(row) => row.id}
      ariaLabel={m.workspace_resizablePanels_activity_label()}
      virtualize={false}
      class="overflow-visible"
    >
      {#snippet row({ item })}
        <ListRow
          class="min-h-[42px] gap-2.5 px-2.5 py-1.5 [&_[data-slot=list-row-title]]:whitespace-normal [&_[data-slot=list-row-title]]:break-words [&_[data-slot=list-row-title]]:[overflow-wrap:anywhere] [&_[data-slot=list-row-title]]:text-[11px] [&_[data-slot=list-row-title]]:leading-4 [&_[data-slot=list-row-leading]]:text-[11px] [&_[data-slot=list-row-leading]]:leading-4 [&_[data-slot=list-row-trailing]]:text-[11px] [&_[data-slot=list-row-trailing]]:leading-4"
        >
          {#snippet leading()}
            <PrincipalAvatar
              label={item.name}
              avatarUrl={item.avatarUrl}
              size={30}
              class="border border-border"
            />
          {/snippet}
          {#snippet title()}{item.label}{/snippet}
          {#snippet trailing()}
            <RelativeTime
              date={item.timestamp}
              compact
              class="whitespace-nowrap text-[11px] leading-4 text-muted-foreground"
            />
          {/snippet}
        </ListRow>
      {/snippet}
    </ListView>
  {/if}

  {#if $error$}
    <ErrorState
      density="compact"
      retryLabel={m.workspace_activityPanel_retryOlder_label()}
      onRetry={() => appStore.dispatch(loadEventsRequested(workspaceId))}
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

  {#if !$error$ && !$loading$ && $nextToken$ && !$endReached$}
    <div class="flex flex-col items-center gap-1 px-2.5 py-2">
      {#if $olderError$}
        <p class="type-caption text-muted-foreground" role="status">
          {m.workspace_peopleActivity_loadOlder_error()}
        </p>
      {/if}
      <Button
        variant="ghost"
        size="compact"
        loading={$loadingOlder$}
        onclick={() => appStore.dispatch(loadOlderEventsRequested(workspaceId))}
      >
        {$loadingOlder$
          ? m.workspace_activityPanel_loadingOlder_label()
          : $olderError$
            ? m.workspace_activityPanel_retryOlder_label()
            : m.workspace_peopleActivity_loadMore_label()}
      </Button>
    </div>
  {/if}
</div>
