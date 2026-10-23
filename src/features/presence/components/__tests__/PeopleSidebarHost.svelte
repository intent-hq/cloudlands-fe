<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { presenceRosterReceived } from '$store/renderer/slices/presence/presence-slice';
  import { Button } from '$lib/components/ui/button';
  import PeoplePreview from '../workspace-people-tile.preview.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import {
    bulkUpsertSessions,
    removeSession,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import type { WireAgentSession } from '$store/renderer/slices/agent-session/agent-session-types';
  import {
    eventReceived,
    olderEventsLoaded,
    peopleEventsLoadStarted,
    peopleEventsPageLoaded,
    peopleEventsLoadFinished,
  } from '$store/renderer/slices/workspace-events/workspace-events-slice';
  import { selectShareDialogOpen } from '$store/renderer/slices/workspace-share/workspace-share-selectors';
  import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import {
    discussionContextChanged,
    discussionManagementCapabilityReceived,
  } from '$store/renderer/slices/workspace-discussion/workspace-discussion-slice';
  import {
    selectDiscussionContext,
    selectDiscussionOwner,
  } from '$store/renderer/slices/workspace-discussion/workspace-discussion-selectors';
  import {
    initializeLayout,
    clearPanelLayout,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import {
    selectPanels,
    selectFocusedPanelId,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';

  let {
    guest = false,
    roster,
    older = false,
    emptyOlder = false,
  }: {
    guest?: boolean;
    older?: boolean;
    emptyOlder?: boolean;
    roster?: 'mixed' | 'pending';
  } = $props();
  const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  const sharingOpen = selectShareDialogOpen();
  const workspaceId = 'people-tile-preview';
  onMount(() => {
    const context = selectDiscussionContext.select(store.state);
    store.dispatch(discussionContextChanged(context, selectDiscussionOwner.select(store.state)));
    if (context) store.dispatch(discussionManagementCapabilityReceived(context, true));
  });
  let messageNavigation = $state<Record<string, string>>({});
  function recordMessageNavigation(event: Event) {
    const detail = (event as CustomEvent).detail;
    messageNavigation = {
      agentId: detail.agentId,
      messageId: detail.messageId,
      targetTabId: detail.targetTabId,
    };
  }
  window.addEventListener('chat:open-message', recordMessageNavigation);
  store.dispatch(
    bulkUpsertSessions([
      {
        id: 'planner',
        workspaceId,
        name: 'Planner',
        messages: [
          {
            id: 'message-1',
            role: 'user',
            timestamp: '2026-10-14T12:00:00Z',
            contentBlocks: [{ type: 'text', text: 'Let’s keep the People panel open' }],
          },
        ],
      } as WireAgentSession,
    ]),
  );
  const panels$ = selectPanels(workspaceId);
  const focusedPanel$ = selectFocusedPanelId(workspaceId);
  store.dispatch(
    initializeLayout(workspaceId, {
      root: {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'panel', panelId: 'current' },
          { type: 'panel', panelId: 'neighbor' },
        ],
        sizes: [50, 50],
      },
      panels: {
        current: {
          id: 'current',
          activeTabId: 'original',
          tabs: [
            {
              id: 'original',
              type: 'note',
              noteId: 'spec',
              title: 'Spec',
              workspaceId,
              closable: true,
            },
          ],
        },
        neighbor: {
          id: 'neighbor',
          activeTabId: 'neighbor-note',
          tabs: [
            {
              id: 'neighbor-note',
              type: 'note',
              noteId: 'sidebar-mockup',
              title: 'Sidebar mockup',
              workspaceId,
              closable: true,
            },
          ],
        },
      },
      focusedPanelId: 'current',
    }),
  );

  function addActivity() {
    store.dispatch(
      eventReceived(workspaceId, {
        id: 'live-comment',
        workspaceId,
        type: 'comment:added',
        timestamp: new Date().toISOString(),
        actor: { type: 'user', id: 'person-3', name: 'Taylor' },
        data: { noteId: 'people-layout', commentId: 'new-comment' },
      }),
    );
  }

  function receiveOlder() {
    // The general event feed may still have pages after both People streams finish.
    store.dispatch(olderEventsLoaded(workspaceId, [], 'raw-history-continues'));
    store.dispatch(peopleEventsLoadStarted(workspaceId, 'older-people'));
    store.dispatch(
      peopleEventsPageLoaded(
        workspaceId,
        'older-people',
        'user',
        [
          {
            id: 'older-note',
            workspaceId,
            type: 'note:created',
            timestamp: new Date(Date.now() - 3_600_000).toISOString(),
            actor: { type: 'user', id: 'former-member', name: 'Casey' },
            data: { noteId: 'old-plan', title: 'Earlier plan' },
          },
        ],
        null,
      ),
    );
    store.dispatch(peopleEventsPageLoaded(workspaceId, 'older-people', 'message', [], null));
    store.dispatch(peopleEventsLoadFinished(workspaceId, 'older-people', true, null));
  }

  onDestroy(() => {
    store.dispatch(discussionContextChanged(null, null));
    window.removeEventListener('chat:open-message', recordMessageNavigation);
    store.dispatch(removeSession('planner'));
    store.dispatch(clearPanelLayout(workspaceId));
    dispose();
  });
</script>

<div style:width="346px">
  <PeoplePreview
    sidebar
    {guest}
    {roster}
    count={roster === 'pending' ? 1 : 3}
    shared={roster !== 'pending'}
    activityState={emptyOlder ? 'older-empty' : older ? 'older' : 'ready'}
  />
</div>
<Button onclick={addActivity}>Add live activity</Button>
<Button onclick={receiveOlder}>Receive older activity</Button>
<Button onclick={() => store.dispatch(setLabsMultiplayerEnabled(false))}>Disable multiplayer</Button
>
<output data-share-dialog-open>{String($sharingOpen)}</output>
<output data-people-navigation
  >{JSON.stringify({ panels: $panels$, focusedPanel: $focusedPanel$ })}</output
>
<output data-people-message-navigation>{JSON.stringify(messageNavigation)}</output>

<Button onclick={() => store.dispatch(presenceRosterReceived({ workspaceId, members: [] }))}
  >Disconnect people</Button
>
