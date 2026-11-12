<script lang="ts">
  // A deliberately bare ChatPanel host: it starts no draft saga of its own, the
  // way a new host would be written. The CT bootstrap must still answer the
  // composer's draft restore (chat-draft-default.ct.spec.ts).
  import { onDestroy } from 'svelte';
  import { AgentStatus, type AgentSession } from '$shared/types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { setAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
  import ChatPanel from '../ChatPanel.svelte';

  let {
    workspaceId,
    agentId,
    ownsStoreLifecycle = false,
  }: { workspaceId: string; agentId: string; ownsStoreLifecycle?: boolean } = $props();

  const timestamp = '2026-11-04T12:00:00.000Z';
  // svelte-ignore state_referenced_locally -- each CT mount uses one immutable fixture.
  const ids = { workspaceId, agentId };
  const disposeStore = ownsStoreLifecycle
    ? startRootStoreLifecycle(store, { startSagas: () => [] })
    : () => {};
  admitLegacyPrincipal();
  const session = {
    id: ids.agentId,
    workspaceId: ids.workspaceId,
    name: 'Draft default agent',
    status: AgentStatus.RuntimeIdle,
    isActive: true,
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  } as unknown as AgentSession;
  store.dispatch(
    setWorkspaceEntity({
      id: ids.workspaceId,
      title: 'Draft default',
      myRole: 'owner',
      branch: 'test',
      status: 'active',
      path: '/tmp/chat-draft-default',
      createdAt: timestamp,
      updatedAt: timestamp,
    } as never),
  );
  store.dispatch(bulkUpsertSessions([session], { preserveExplicitRuntimeFlags: false }));
  store.dispatch(setAgents(ids.workspaceId, [session]));
  const workspace$ = selectWorkspaceById(ids.workspaceId);
  onDestroy(disposeStore);
</script>

<div class="relative" style:width="480px" style:height="420px">
  {#if $workspace$}
    <ChatPanel
      workspace={$workspace$}
      agentId={ids.agentId}
      agentName={session.name}
      isActive
      isPanelFocused
    />
  {/if}
</div>
