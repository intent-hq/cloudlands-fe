<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
  import { restoreStoredSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { AgentStatus, WorkspaceStatus } from '$shared/types';
  import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import { principalContextChanged } from '$store/renderer/slices/principal/principal-slice';
  import { installDiscussionTestBackend, startDiscussionTestSaga } from './discussion-test-backend';
  import {
    setWorkspaceEntity,
    removeWorkspaceEntity,
  } from '$store/renderer/slices/workspace/workspace-slice';
  import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import {
    discussionAgentCapabilityReceived,
    discussionLoadStarted,
    discussionPageReceived,
    discussionLoadFinished,
    discussionMessageReceived,
  } from '$store/renderer/slices/workspace-discussion/workspace-discussion-slice';
  import { selectDiscussionTarget } from '$store/renderer/slices/workspace-discussion/workspace-discussion-selectors';
  import WorkspaceDiscussion from '../WorkspaceDiscussion.svelte';

  let {
    failSend = false,
    messageActions = true,
    agentMessaging = false,
    conversationId = 'default',
  }: {
    failSend?: boolean;
    messageActions?: boolean;
    agentMessaging?: boolean;
    conversationId?: string;
  } = $props();
  const workspaceId = 'discussion-test';
  let mounted = $state(true);
  let requests = $state<Array<{ method: string; params: unknown }>>([]);
  const backend = installDiscussionTestBackend(
    workspaceId,
    () => failSend,
    (calls) => {
      requests = calls;
    },
    { messageActions, agentMessaging },
  );
  const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  store.dispatch(setLabsMultiplayerEnabled(true));
  store.dispatch(
    setWorkspaceEntity({
      id: WorkspaceId(workspaceId),
      title: 'Review together',
      repositoryName: 'intent',
      branch: 'main',
      status: WorkspaceStatus.Active,
      myRole: 'owner',
      memberCount: 2,
      ownerPrincipalId: 'owner',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      createdAt: '2026-10-14T12:00:00Z',
      updatedAt: '2026-10-14T12:00:00Z',
    }),
  );
  store.dispatch(
    restoreStoredSessions(
      [
        ['agent-reviewer', 'Reviewer', workspaceId, null],
        ['agent-builder', 'Builder', workspaceId, null],
        ['agent-retired', 'Retired helper', workspaceId, '2026-10-19T10:00:00Z'],
        ['agent-deleted', 'Deleted helper', workspaceId, null],
        ['agent-elsewhere', 'Elsewhere helper', 'another-workspace', null],
      ].map(([id, name, wsId, retiredAt]) => ({
        id: AgentId(id!),
        workspaceId: WorkspaceId(wsId!),
        name: name!,
        backendSessionId: null,
        status: id === 'agent-deleted' ? AgentStatus.Deleted : AgentStatus.Active,
        messages: [],
        createdAt: '2026-10-14T12:00:00Z',
        updatedAt: '2026-10-14T12:00:00Z',
        ...(retiredAt ? { retiredAt } : {}),
      })),
    ),
  );
  store.dispatch(openWorkspaceTab(workspaceId));
  admitLegacyPrincipal();
  let cancel: (() => void) | undefined;
  onMount(() => {
    cancel = startDiscussionTestSaga();
  });
  onDestroy(() => {
    cancel?.();
    store.dispatch(removeWorkspaceEntity(workspaceId));
    dispose();
    backend.restore();
  });
  function failCatchUp() {
    const target = selectDiscussionTarget.select(store.state, workspaceId);
    if (!target) return;
    store.dispatch(discussionLoadStarted(target, 'catch-up-test', false));
    store.dispatch(
      discussionPageReceived(
        target,
        'catch-up-test',
        { messages: [backend.message(100)], hasMore: true, conversation: backend.conversation() },
        'newer',
      ),
    );
    store.dispatch(discussionLoadFinished(target, 'catch-up-test', 'unknown'));
  }
  function liveMessage() {
    const target = selectDiscussionTarget.select(store.state, workspaceId);
    if (target)
      store.dispatch(
        discussionMessageReceived(target, backend.message(100, 'A live update from a teammate.')),
      );
  }
</script>

<div class="h-[560px] w-full max-w-[390px]" data-discussion-test-pane>
  {#if mounted}<WorkspaceDiscussion {workspaceId} {conversationId} isPanelFocused />{/if}
</div>
<Button
  onclick={() => {
    mounted = !mounted;
  }}>Toggle discussion</Button
>
<Button onclick={() => backend.finishOlder()}>Finish history</Button>
<Button onclick={liveMessage}>Receive live message</Button>
<Button onclick={() => backend.receiveTyping()}>Receive peer typing</Button>
<Button onclick={() => backend.receiveTyping(true)}>Renew peer typing</Button>
<Button onclick={() => store.dispatch(setLabsMultiplayerEnabled(false))}>Disable multiplayer</Button
>
<Button onclick={failCatchUp}>Fail reconnect catch-up</Button>
<Button
  onclick={() => {
    store.dispatch(connectionStatusChanged('disconnected'));
    store.dispatch(principalContextChanged(null));
  }}>Disconnect</Button
>
{#if agentMessaging}
  <Button
    onclick={() => {
      const target = selectDiscussionTarget.select(store.state, workspaceId);
      if (target)
        store.dispatch(
          discussionMessageReceived(target, {
            ...backend.message(102, 'I checked the changes. The layout looks good.'),
            recipientAgentIds: [],
            author: {
              principalId: null,
              agentId: 'agent-reviewer',
              displayName: 'Reviewer',
              login: null,
              avatarUrl: null,
            },
          }),
        );
    }}>Receive agent reply</Button
  >
  <Button
    onclick={() =>
      store.dispatch(
        discussionAgentCapabilityReceived(store.state.workspaceDiscussion.context!, false),
      )}>Disable agent messaging</Button
  >
{/if}
<output data-discussion-requests>{JSON.stringify(requests)}</output>
