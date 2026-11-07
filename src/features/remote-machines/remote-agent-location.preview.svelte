<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Scene =
    | 'long-machine-name'
    | 'local'
    | 'remote-running'
    | 'remote-starting'
    | 'remote-preparing-checkout'
    | 'remote-running-setup'
    | 'remote-setup-failed'
    | 'remote-update-required'
    | 'remote-failed'
    | 'machine-unreachable'
    | 'machine-revoked'
    | 'labs-off'
    | 'picker'
    | 'picker-stale'
    | 'picker-missing'
    | 'picker-older-backend'
    | 'e2b-starting'
    | 'e2b-running'
    | 'e2b-paused'
    | 'e2b-quota'
    | 'e2b-profile-required'
    | 'e2b-unavailable';

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
      'long-machine-name': sceneState('long-machine-name'),
      'remote-running': sceneState('remote-running'),
      'remote-starting': sceneState('remote-starting'),
      'remote-preparing-checkout': sceneState('remote-preparing-checkout'),
      'remote-running-setup': sceneState('remote-running-setup'),
      'remote-setup-failed': sceneState('remote-setup-failed'),
      'remote-update-required': sceneState('remote-update-required'),
      'remote-failed': sceneState('remote-failed'),
      'machine-unreachable': sceneState('machine-unreachable'),
      'machine-revoked': sceneState('machine-revoked'),
      'labs-off': sceneState('labs-off'),
      picker: sceneState('picker'),
      'picker-stale': sceneState('picker-stale'),
      'picker-missing': sceneState('picker-missing'),
      'picker-older-backend': sceneState('picker-older-backend'),
      'e2b-starting': sceneState('e2b-starting'),
      'e2b-running': sceneState('e2b-running'),
      'e2b-paused': sceneState('e2b-paused'),
      'e2b-quota': sceneState('e2b-quota'),
      'e2b-profile-required': sceneState('e2b-profile-required'),
      'e2b-unavailable': sceneState('e2b-unavailable'),
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
  import { cloudMachinesLoaded } from '$features/cloud-machines/cloud-machines-slice';
  import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
  import { setProviderEnabled } from '$store/renderer/slices/provider-settings/provider-settings-slice';
  import { providerModelsLoaded } from '$store/renderer/slices/provider-models/provider-models-slice';
  import type { ProviderCatalogResult } from '$shared/provider-catalog';
  import { selectProviderCatalogEntries } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { catalogNow } from '$lib/component-catalog/catalog-clock';
  import { MOCK_PROVIDER_CATALOG } from '../../test/fixtures/provider-catalog.fixture';

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

  // Model picker scenes: what Mac mini reported, and this backend's profiles.
  const isPickerScene = (s: Scene) => s.startsWith('picker');
  const MAC_REPORT = {
    intentdVersion: '0.240.0',
    providers: [
      { id: 'claude-code', status: 'ready', models: ['opus', 'sonnet', 'haiku'] },
      { id: 'codex', status: 'signed-out', models: ['gpt-6', 'gpt-6-mini'] },
    ],
  };
  const pickerCatalog = (s: Scene): ProviderCatalogResult => ({
    ...MOCK_PROVIDER_CATALOG,
    profiles:
      s === 'picker-older-backend'
        ? [
            {
              id: 'p-work',
              providerRef: 'claude-code@p-work',
              baseProviderId: 'claude-code',
              name: 'Work',
            },
          ]
        : [
            {
              id: 'p-work',
              providerRef: 'claude-code@p-work',
              baseProviderId: 'claude-code',
              name: 'Work',
              remoteCompatible: false,
              remoteIncompatibility: { reason: 'account-folder', keys: ['CLAUDE_CONFIG_DIR'] },
            },
            {
              id: 'p-key',
              providerRef: 'codex@p-key',
              baseProviderId: 'codex',
              name: 'API key',
              remoteCompatible: true,
            },
          ],
  });
  const reportedAt = (s: Scene) =>
    new Date(catalogNow() - (s === 'picker-stale' ? 3 * 24 * 60 : 2) * 60 * 1000).toISOString();

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

  const STARTING_SCENES: Scene[] = [
    'remote-starting',
    'remote-preparing-checkout',
    'remote-running-setup',
  ];
  const SETUP_OUTPUT = [
    'Fetching the workspace from the backend…',
    'Fetching packages/intentd…',
    'Fetching packages/cloudlands-fe…',
    'Checkout ready.',
    '$ make bootstrap',
    '\u001b[32m✓\u001b[0m rustup toolchain 1.92.0 installed',
    'pnpm install --frozen-lockfile',
    'Lockfile is up to date, resolution step is skipped',
    'Packages: +1843',
    'Progress: resolved 1843, reused 1790, downloaded 53, added 1843, done',
    '',
  ].join('\n');
  const SETUP: Partial<Record<Scene, AgentSession['setup']>> = {
    'remote-preparing-checkout': {
      state: 'pending',
      output: SETUP_OUTPUT.split('\n').slice(0, 2).join('\n'),
    },
    'remote-running-setup': {
      state: 'running',
      startedAt: '2026-11-02T08:24:10.000Z',
      output: SETUP_OUTPUT,
    },
    'remote-setup-failed': {
      state: 'failed',
      exitCode: 2,
      startedAt: '2026-11-02T08:24:10.000Z',
      finishedAt: '2026-11-02T08:25:02.000Z',
      output: `${SETUP_OUTPUT}$ cargo build --locked\nerror: failed to download \`serde v1.0.228\`\nmake: *** [bootstrap] Error 2\nSetup script failed in 52s (exit code 2)\n`,
      outputTruncated: true,
    },
  };

  // Agents on E2B: a sandbox row while it runs or is paused; start fields and errors otherwise.
  const E2B_NODE = 'd-e2b-sandbox-1';
  const isE2bScene = (s: Scene) => s.startsWith('e2b-');
  const E2B_ERRORS: Partial<Record<Scene, { code: string; detail: string }>> = {
    'e2b-quota': {
      code: 'cloud-quota',
      detail:
        'E2B refused a new sandbox: concurrency limit reached. {"code":"cloud-quota","provider":"e2b","limit":"concurrency","retryable":true}',
    },
    'e2b-profile-required': {
      code: 'cloud-profile-required',
      detail:
        'Work uses this backend\'s Claude sign-in, which E2B can\'t use. {"code":"cloud-profile-required","provider":"e2b","providerRef":"claude-code"}',
    },
    'e2b-unavailable': {
      code: 'cloud-machine-unavailable',
      detail:
        'E2B failed (503). No sandbox was left behind. {"code":"cloud-machine-unavailable","provider":"e2b","reason":"api-error","retryable":true,"status":503}',
    },
  };
  const e2bAgent = (s: Scene): AgentSession =>
    agent('ral-e2b', 'Docs sweeper', {
      nodeName: 'E2B',
      placement: { target: 'e2b', checkout: 'isolated' },
      ...(s === 'e2b-running' || s === 'e2b-paused'
        ? { nodeId: E2B_NODE, leaseId: 'lease-e2b', effectiveIsolation: 'isolated' as const }
        : { effectiveIsolation: 'pending' as const }),
      ...(s === 'e2b-starting' ? { cloudStart: { step: 'starting-daemon' } } : {}),
      ...(E2B_ERRORS[s] ? { status: AgentStatus.Error, placementError: E2B_ERRORS[s] } : {}),
      updatedAt: '2026-11-02T08:20:00.000Z',
    });
  const e2bSandbox = (s: Scene): RemoteMachine => ({
    ...machine(E2B_NODE, 'E2B · Docs sweeper', 'linux', 'x86_64', 'connected'),
    hosts: [],
    cloud: {
      provider: 'e2b',
      cloudMachineId: 'e2b',
      sandboxId: 'isx1k2v9',
      state: s === 'e2b-paused' ? 'paused' : 'running',
      template: 'intent/intent-node-4x8:0.240.0',
      size: '4x8',
      startedBy: { principalId: 'p-sam', displayName: 'Sam' },
      agentId: 'ral-e2b',
      workspaceId: WS,
      startedAt: T,
      runningSeconds: 2520,
    },
  });

  const agentsFor = (s: Scene): AgentSession[] => [
    ...(isE2bScene(s) ? [e2bAgent(s)] : []),
    agent('ral-local', 'Spec writer', { updatedAt: '2026-11-02T08:30:00.000Z' }),
    agent('ral-mac', 'iOS build fixer', {
      ...remote(
        MAC,
        s === 'long-machine-name' ? "Clement's Mac Studio in the upstairs office" : 'Mac mini',
        'macos',
        'aarch64',
      ),
      effectiveIsolation: STARTING_SCENES.includes(s) ? 'pending' : 'isolated',
      ...(SETUP[s] ? { setup: SETUP[s] } : {}),
      ...(s === 'remote-update-required'
        ? {
            status: AgentStatus.Error,
            placementError: {
              code: 'remote-launch-failed',
              detail: `Update Intent on Mac mini to run agents for this workspace: it has submodules or a setup script. {"code":"machine-update-required","machineVersion":"0.11.120","backendVersion":"0.11.134","update":"machine","reason":"prepared-checkout"}`,
            },
          }
        : {}),
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
      ...remote(
        MAC,
        s === 'long-machine-name' ? "Clement's Mac Studio in the upstairs office" : 'Mac mini',
        'macos',
        'aarch64',
      ),
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
    isE2bScene(scene)
      ? 'ral-e2b'
      : scene === 'local'
        ? 'ral-local'
        : scene === 'machine-unreachable'
          ? 'ral-box'
          : 'ral-mac',
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
    const previousProviders = selectProviderCatalogEntries.select(store.state);
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
      store.dispatch(providerCatalogLoaded({ providers: previousProviders }));
      store.dispatch(clearPanelLayout(WS));
      store.dispatch(removeWorkspaceEntity(WS));
      dispose();
    };
  });

  $effect(() => {
    const s = scene;
    store.dispatch(setLabsRemoteAgentsEnabled(s !== 'labs-off'));
    if (isPickerScene(s)) {
      store.dispatch(providerCatalogLoaded(pickerCatalog(s)));
      for (const providerId of ['claude-code', 'codex'])
        store.dispatch(setProviderEnabled({ providerId, enabled: true }));
      // This backend's labels for the machine's model ids.
      store.dispatch(
        providerModelsLoaded(
          'claude-code',
          {
            models: [
              { value: 'opus', label: 'Opus 5.5', description: 'Most capable' },
              { value: 'sonnet', label: 'Sonnet 5', description: 'Fast and capable' },
              { value: 'haiku', label: 'Haiku 5', description: 'Quick everyday tasks' },
            ],
          },
          0,
        ),
      );
    }
    const mac = machine(
      MAC,
      'Mac mini',
      'macos',
      'aarch64',
      s === 'machine-revoked' ? 'revoked' : 'connected',
    );
    store.dispatch(
      remoteMachinesLoaded({
        supported: true,
        machines: [
          isPickerScene(s) && s !== 'picker-missing'
            ? { ...mac, capabilities: MAC_REPORT, observedAt: reportedAt(s) }
            : mac,
          machine(BOX, 'Build box', 'linux', 'x86_64', 'unreachable'),
        ],
        localFingerprint: null,
        executorBackends: null,
      }),
    );
    store.dispatch(
      cloudMachinesLoaded({
        supported: true,
        providers: [],
        machines: s === 'e2b-running' || s === 'e2b-paused' ? [e2bSandbox(s)] : [],
        readAt: 0,
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
