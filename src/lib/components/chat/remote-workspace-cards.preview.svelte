<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview<{ scenario: 'overview' | 'remote' | 'unavailable' }>({
    id: 'remote-workspace-cards',
    title: 'Assistant workspace cards on other machines',
    defaultState: 'overview',
    states: {
      overview: { props: { scenario: 'overview' } },
      remote: { props: { scenario: 'remote' } },
      unavailable: { props: { scenario: 'unavailable' } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { store as appStore } from '$store/renderer/store';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import {
    remoteWorkspaceCardsReceived,
    remoteWorkspaceCardsStarted,
  } from '$store/renderer/slices/remote-workspace-cards/remote-workspace-cards-slice';
  import type { WorkspaceCardRef } from '$lib/utils/messageParser';
  import { WorkspaceStatus, createWorkspaceId, type Workspace } from '$shared/types';
  import ChatWorkspaceCard from './ChatWorkspaceCard.svelte';

  let { scenario = 'overview' }: { scenario?: 'overview' | 'remote' | 'unavailable' } = $props();

  // A fixed time: the preview runs without the sagas that would read the cards again.
  const PREVIEW_LOADED_AT = Date.parse('2026-11-21T12:00:00.000Z');
  const studio = 'fp:PREVIEW:STUDIO';
  const intent1 = 'fp:PREVIEW:INTENT1';
  const unsaved = 'fp:PREVIEW:UNSAVED';
  const offline = 'fp:PREVIEW:OFFLINE';
  const pending = 'fp:PREVIEW:PENDING';

  function workspace(id: string, title: string, branch: string): Workspace {
    return {
      id: createWorkspaceId(id),
      title,
      branch,
      status: WorkspaceStatus.Active,
      changesets: [],
      timeline: [],
      conversationInfo: [],
      repositoryOwner: 'intent-hq',
      repositoryName: 'intent',
      createdAt: '2026-11-21T09:00:00.000Z',
      updatedAt: '2026-11-21T12:00:00.000Z',
      lastActivity: '2026-11-21T12:00:00.000Z',
    } as Workspace;
  }

  const refsByScenario: Record<typeof scenario, WorkspaceCardRef[]> = {
    overview: [
      { workspaceId: 'finance-team' },
      { workspaceId: 'safari-fix', backendId: studio },
      { workspaceId: 'registry-tests', backendId: intent1 },
      { workspaceId: 'loading-space', backendId: pending },
      { workspaceId: 'unsaved-space', backendId: unsaved },
      { workspaceId: 'offline-space', backendId: offline },
      { workspaceId: 'missing-space', backendId: studio },
    ],
    remote: [
      { workspaceId: 'safari-fix', backendId: studio },
      { workspaceId: 'registry-tests', backendId: intent1 },
    ],
    unavailable: [
      { workspaceId: 'loading-space', backendId: pending },
      { workspaceId: 'unsaved-space', backendId: unsaved },
      { workspaceId: 'offline-space', backendId: offline },
      { workspaceId: 'missing-space', backendId: studio },
    ],
  };
  let refs = $derived(refsByScenario[scenario]);
  let ready = $state(false);

  onMount(() => {
    const now = PREVIEW_LOADED_AT;
    appStore.dispatch(setWorkspaceEntity(workspace('finance-team', 'Finance Team', 'main')));
    appStore.dispatch(
      remoteWorkspaceCardsReceived(
        studio,
        ['safari-fix', 'missing-space'],
        {
          status: 'ok',
          machineName: 'Mac Studio',
          workspaces: [workspace('safari-fix', "Jarvis's Safari fix", 'fix/safari')],
        },
        now,
      ),
    );
    appStore.dispatch(
      remoteWorkspaceCardsReceived(
        intent1,
        ['registry-tests'],
        {
          status: 'ok',
          machineName: 'intent1',
          workspaces: [workspace('registry-tests', 'Provider registry snapshot', 'test/registry')],
        },
        now,
      ),
    );
    appStore.dispatch(remoteWorkspaceCardsStarted(pending, ['loading-space']));
    appStore.dispatch(
      remoteWorkspaceCardsReceived(unsaved, ['unsaved-space'], { status: 'unknown-backend' }, now),
    );
    appStore.dispatch(
      remoteWorkspaceCardsReceived(
        offline,
        ['offline-space'],
        { status: 'unreachable', machineName: 'Mac mini' },
        now,
      ),
    );
    ready = true;
  });
</script>

<section class="w-full max-w-2xl bg-background p-4 text-sm text-foreground">
  {#if ready}
    <ChatWorkspaceCard workspaceIds={refs.map((ref) => ref.workspaceId)} {refs} />
  {/if}
</section>
