<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Scene =
    | 'local'
    | 'remote-running'
    | 'remote-starting'
    | 'remote-failed'
    | 'machine-unreachable'
    | 'machine-revoked'
    | 'labs-off';

  interface Props {
    scene?: Scene;
  }

  const sceneState = (scene: Scene) => ({ props: { scene } });
  export const preview = definePreview<Props>({
    id: 'remote-agent-location',
    title: 'Where a remote agent runs',
    defaultState: 'remote-running',
    states: {
      local: sceneState('local'),
      'remote-running': sceneState('remote-running'),
      'remote-starting': sceneState('remote-starting'),
      'remote-failed': sceneState('remote-failed'),
      'machine-unreachable': sceneState('machine-unreachable'),
      'machine-revoked': sceneState('machine-revoked'),
      'labs-off': sceneState('labs-off'),
    },
    captureReadiness: { selector: '[data-remote-agent-location-scene][data-ready]' },
  });
</script>

<!--
  A sidebar Agents list, the agent panel header and the conversation + composer,
  built from the real components with one local agent and agents on two
  machines: Mac mini (macOS arm64) and Build box (Linux x64).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
  import {
    removeWorkspaceEntity,
    setWorkspaceEntity,
  } from '$store/renderer/slices/workspace/workspace-slice';
  import {
    clearPanelLayout,
    initializeLayout,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import {
    bulkUpsertSessions,
    removeSession,
  } from '$store/renderer/slices/agent-session/agent-session-slice';
  import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { AgentStatus, WorkspaceStatus, type AgentSession } from '$shared/types';
  import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
  import type { RemoteMachine, RemoteMachineState } from '$shared/types/remote-machines';
  import WorkspaceAgentsList from '$lib/components/workspace/WorkspaceAgentsList.svelte';
  import PanelTabBar from '$lib/components/layout/panel-system/PanelTabBar.svelte';
  import SimpleRichInput from '$lib/components/chat/input/SimpleRichInput.svelte';
  import AgentPlacementNotice from './AgentPlacementNotice.svelte';
  import { remoteMachinesLoaded } from './remote-machines-slice';

  let { scene = 'remote-running' }: Props = $props();

  const WS = 'remote-agent-location-preview';
  const T = '2026-11-02T08:00:00.000Z';
  const MAC = 'node-mac-mini';
  const BOX = 'node-build-box';

  const machine = (
    id: string,
    name: string,
    os: string,
    arch: string,
    state: RemoteMachineState,
  ): RemoteMachine => ({
    id,
    name,
    platform: { os, arch },
    hosts: ['192.0.2.4'],
    port: 5179,
    fingerprint: `fp-${id}`,
    state,
    runningAgents: 1,
    addedAt: T,
  });

  const remote = (nodeId: string, nodeName: string, os: 'macos' | 'linux', arch: string) => ({
    nodeId,
    nodeName,
    leaseId: `lease-${nodeId}`,
    placement: {
      target: 'remote' as const,
      checkout: 'isolated' as const,
      os,
      arch: arch as 'aarch64' | 'x86_64',
      nodeId,
    },
  });

  const agent = (id: string, name: string, extra: Partial<AgentSession> = {}): AgentSession =>
    ({
      id: AgentId(id),
      workspaceId: WorkspaceId(WS),
      backendSessionId: null,
      name,
      nameExplicitlySet: true,
      status: AgentStatus.Idle,
      messages: [],
      createdAt: T,
      updatedAt: T,
      provider: 'claude-code',
      model: 'opus',
      ...extra,
    }) as AgentSession;

  const agentsFor = (s: Scene): AgentSession[] => [
    agent('ral-local', 'Spec writer', { updatedAt: '2026-11-02T08:30:00.000Z' }),
    agent('ral-mac', 'iOS build fixer', {
      ...remote(MAC, 'Mac mini', 'macos', 'aarch64'),
      effectiveIsolation: s === 'remote-starting' ? 'pending' : 'isolated',
      ...(s === 'remote-failed'
        ? {
            status: AgentStatus.Error,
            placementError: {
              code: 'remote-launch-failed',
              detail: "node-provider-unavailable: Claude Code isn't signed in on Mac mini.",
            },
          }
        : {}),
      updatedAt: '2026-11-02T08:24:00.000Z',
    }),
    agent('ral-mac-2', 'Xcode test runner', {
      ...remote(MAC, 'Mac mini', 'macos', 'aarch64'),
      effectiveIsolation: 'isolated',
      updatedAt: '2026-11-02T07:58:00.000Z',
    }),
    agent('ral-box', 'Linux perf check', {
      ...remote(BOX, 'Build box', 'linux', 'x86_64'),
      effectiveIsolation: 'isolated',
      nodeState: 'offline',
      updatedAt: '2026-11-02T06:10:00.000Z',
    }),
  ];

  const selectedAgentId = $derived(
    scene === 'local' ? 'ral-local' : scene === 'machine-unreachable' ? 'ral-box' : 'ral-mac',
  );
  const agents = $derived(agentsFor(scene));
  const selected = $derived(agents.find((a) => a.id === selectedAgentId) ?? agents[0]!);
  const tab = $derived<PanelTab>({
    id: 'ral-tab',
    type: 'agent',
    title: selected.name ?? '',
    agentId: selectedAgentId,
    closable: true,
  });

  let ready = $state(false);
  let draft = $state('');

  onMount(() => {
    const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
    const previousLabs = store.state.userPreferences?.labsRemoteAgentsEnabled === true;
    admitLegacyPrincipal();
    store.dispatch(
      setWorkspaceEntity({
        id: WorkspaceId(WS),
        branch: 'ios-build-fix',
        changesets: [],
        timeline: [],
        conversationInfo: [],
        title: 'Fix the iOS build',
        path: '/tmp/remote-agent-location-preview',
        status: WorkspaceStatus.Active,
        createdAt: T,
        updatedAt: T,
        myRole: 'owner',
        canManage: true,
      }),
    );
    store.dispatch(
      initializeLayout(WS, {
        root: { type: 'panel', panelId: 'ral-panel' },
        panels: { 'ral-panel': { id: 'ral-panel', tabs: [tab], activeTabId: tab.id } },
        focusedPanelId: 'ral-panel',
        columnCount: 1,
      }),
    );
    ready = true;
    return () => {
      for (const a of agentsFor(scene)) store.dispatch(removeSession(a.id));
      store.dispatch(setLabsRemoteAgentsEnabled(previousLabs));
      store.dispatch(clearPanelLayout(WS));
      store.dispatch(removeWorkspaceEntity(WS));
      dispose();
    };
  });

  $effect(() => {
    const s = scene;
    store.dispatch(setLabsRemoteAgentsEnabled(s !== 'labs-off'));
    store.dispatch(
      remoteMachinesLoaded({
        supported: true,
        machines: [
          machine(
            MAC,
            'Mac mini',
            'macos',
            'aarch64',
            s === 'machine-revoked' ? 'revoked' : 'connected',
          ),
          machine(BOX, 'Build box', 'linux', 'x86_64', 'unreachable'),
        ],
        localFingerprint: null,
        executorBackends: null,
      }),
    );
    store.dispatch(bulkUpsertSessions(agentsFor(s)));
  });
</script>

<div
  class="flex h-[720px] w-full min-w-0 bg-background text-foreground"
  data-remote-agent-location-scene={scene}
  data-ready={ready ? '' : undefined}
>
  <aside class="flex w-[300px] shrink-0 flex-col border-r border-border bg-sidebar">
    <h6 class="px-4 pb-1 pt-4 text-ui font-semibold text-foreground">Agents</h6>
    <section class="px-2 pb-4">
      {#if ready}
        <WorkspaceAgentsList {agents} {selectedAgentId} onSelect={() => {}} />
      {/if}
    </section>
  </aside>

  <main class="flex min-w-0 flex-1 flex-col" data-panel-id="ral-panel">
    {#if ready}
      <div class="bg-card text-card-foreground">
        <PanelTabBar
          tabs={[tab]}
          activeTabId={tab.id}
          panelId="ral-panel"
          workspaceId={WS}
          isFocused
        />
      </div>
    {/if}
    <div class="flex min-h-0 flex-1 flex-col items-center">
      <div class="flex w-full max-w-[760px] flex-1 flex-col justify-end px-6 pb-4">
        {#if ready}
          {#key selectedAgentId}
            <AgentPlacementNotice agentId={selectedAgentId} />
          {/key}
        {/if}
      </div>
      <div class="w-full max-w-[760px] px-6 pb-6" id="ral-composer">
        {#if ready}
          {#key selectedAgentId}
            <SimpleRichInput
              bind:value={draft}
              workspace={null}
              agentId={selectedAgentId}
              placeholder="Message {selected.name}"
              tooltipPortalTarget="#ral-composer"
              onsubmit={() => {}}
            />
          {/key}
        {/if}
      </div>
    </div>
  </main>
</div>
