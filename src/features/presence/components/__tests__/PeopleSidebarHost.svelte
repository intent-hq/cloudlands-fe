<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import PeoplePreview from '../workspace-people-tile.preview.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import {
    eventReceived,
    olderEventsLoaded,
  } from '$store/renderer/slices/workspace-events/workspace-events-slice';
  import { selectShareDialogOpen } from '$store/renderer/slices/workspace-share/workspace-share-selectors';
  import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';

  let { guest = false, older = false }: { guest?: boolean; older?: boolean } = $props();
  const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  const sharingOpen = selectShareDialogOpen();
  const workspaceId = 'people-tile-preview';

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
    store.dispatch(
      olderEventsLoaded(
        workspaceId,
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
  }

  onDestroy(dispose);
</script>

<div style:width="346px">
  <PeoplePreview sidebar {guest} activityState={older ? 'older' : 'ready'} />
</div>
<Button onclick={addActivity}>Add live activity</Button>
<Button onclick={receiveOlder}>Receive older activity</Button>
<Button onclick={() => store.dispatch(setLabsMultiplayerEnabled(false))}>Disable multiplayer</Button
>
<output data-share-dialog-open>{String($sharingOpen)}</output>
