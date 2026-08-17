<script lang="ts">
  import { onDestroy } from 'svelte';
  import AgentAvatarCatalog from '$features/agent/components/agent-avatar/AgentAvatarCatalog.svelte';
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import {
    agentAvatarGeometry,
    agentAvatarVariants,
  } from '$features/agent/components/agent-avatar/avatar-size';
  import Tab from '$features/layout/components/panel-tabs/Tab.svelte';
  import AgentSubscriptions from '$lib/components/chat/AgentSubscriptions.svelte';
  import AgentMessageAttributionHeader from '$lib/components/chat/AgentMessageAttributionHeader.svelte';
  import { initAppStore, store as appStore } from '$store/renderer/store';
  import { AgentStatus } from '$shared/types/agent.types';
  import type { AgentSession } from '$shared/types';
  import type { PreloadedStoreState } from '$store/renderer/types';

  const designs = ['coordinator', 'implementor'] as const;
  const attributionSessionRows = [
    { id: 'attribution-neutral', status: AgentStatus.RuntimeIdle },
    { id: 'attribution-running', status: AgentStatus.Processing, isProcessing: true },
    { id: 'attribution-waiting', status: AgentStatus.Waiting },
    { id: 'attribution-error', status: AgentStatus.Error },
    {
      id: 'attribution-attention',
      status: AgentStatus.Waiting,
      attentionRequestKind: 'discussion' as const,
    },
  ] as const;
  const attributionSessions = attributionSessionRows.map(
    (session) =>
      ({
        backendSessionId: null,
        workspaceId: 'avatar-evidence-workspace',
        name: session.id,
        messages: [],
        createdAt: '2026-08-17T00:00:00.000Z',
        updatedAt: '2026-08-17T00:00:00.000Z',
        metadata: { specialist: 'implementor' },
        provider: 'codex',
        ...session,
      }) as AgentSession,
  );
  const storeContext = initAppStore(appStore, {
    agentSessions: {
      byAgentId: Object.fromEntries(attributionSessions.map((session) => [session.id, session])),
      agentIdsByWorkspace: {
        'avatar-evidence-workspace': attributionSessions.map((session) => session.id),
      },
    },
  } as PreloadedStoreState);

  onDestroy(() => storeContext.dispose());
</script>

<main data-agent-avatar-host>
  <AgentAvatarCatalog />
  <section data-agent-avatar-sizes>
    {#each agentAvatarVariants as variant (variant)}
      {#each designs as design (design)}
        <div
          data-avatar-size={agentAvatarGeometry[variant].surface}
          data-avatar-variant-sample={variant}
          data-avatar-optical-design={design}
          style="zoom: 2"
        >
          <AgentAvatarWithState
            agentId="browser-size-agent"
            specialist={design}
            state="running"
            {variant}
          />
        </div>
      {/each}
    {/each}
  </section>
  <section data-live-panel-header style="width: 180px; overflow: hidden">
    <Tab
      id="avatar-evidence"
      active={true}
      runningAgents={[
        { agentId: 'panel-agent-1', state: 'running', specialist: 'coordinator' },
        { agentId: 'panel-agent-2', state: 'unread', specialist: 'implementor' },
        { agentId: 'panel-agent-3', state: 'waiting', specialist: 'verifier' },
        { agentId: 'panel-agent-4', state: 'running', specialist: 'implementor' },
      ]}>Avatar evidence</Tab
    >
  </section>
  <section data-live-subscription-row>
    <AgentSubscriptions
      workspaceId="avatar-evidence-workspace"
      agentId="avatar-evidence-parent"
      visible={true}
      isolatedPreview={{
        agents: [{ id: 'subscription-agent', name: 'Subscription agent', finished: true }],
        initiallyExpanded: true,
      }}
    />
  </section>
  <section data-coordinator-message-cards>
    {#each ['first', 'second'] as card (card)}
      <div data-coordinator-message-card={card}>
        <AgentMessageAttributionHeader
          attribution={{ fromAgentId: `coordinator-${card}`, displayName: 'Coordinator' }}
          preview={`Coordinator message ${card}`}
          expanded={false}
          controlsId={`coordinator-message-${card}`}
          specialist="spec-writer"
          ontoggle={() => {}}
        />
      </div>
    {/each}
  </section>
  <section data-attribution-state-cards>
    {#each attributionSessions as session (session.id)}
      <div data-attribution-state-card={session.id.replace('attribution-', '')}>
        <AgentMessageAttributionHeader
          attribution={{ fromAgentId: session.id, displayName: session.id }}
          preview={`Message from ${session.id}`}
          expanded={false}
          controlsId={`${session.id}-message`}
          ontoggle={() => {}}
        />
      </div>
    {/each}
  </section>
  <AgentAvatarWithState
    agentId="browser-theme-agent"
    provider="codex"
    state="attention-discussion"
    variant="standard"
    class="theme-avatar"
  />
</main>

<style>
  [data-coordinator-message-cards] {
    display: grid;
    gap: 8px;
    width: 420px;
  }

  [data-attribution-state-cards] {
    display: grid;
    gap: 8px;
    width: 420px;
  }

  [data-coordinator-message-card] :global([data-testid='agent-message-disclosure-header']),
  [data-attribution-state-card] :global([data-testid='agent-message-disclosure-header']) {
    display: flex;
    box-sizing: border-box;
    height: 36px;
    align-items: center;
    gap: 8px;
  }

  [data-coordinator-message-card] :global(button),
  [data-coordinator-message-card] :global([data-agent-message-leading-identity]),
  [data-attribution-state-card] :global(button),
  [data-attribution-state-card] :global([data-agent-message-leading-identity]) {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }
</style>
