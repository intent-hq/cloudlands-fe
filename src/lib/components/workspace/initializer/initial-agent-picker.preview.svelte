<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { catalogNow } from '$lib/component-catalog/catalog-clock';
  import { store } from '$store/renderer/store';
  import type { RemoteMachine, RemoteMachineState } from '$shared/types/remote-machines';
  import { remoteMachinesLoaded } from '$features/remote-machines/remote-machines-slice';
  import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
  import { selectConnections } from '$store/renderer/slices/connections/connections-selectors';
  import { setLabsRemoteAgentsEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { backendReconnected } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
  import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
  import { selectProviderCatalogEntries } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { setupPreviewProviders } from '$lib/components/settings/provider-selector.preview';
  import {
    setupModelPickerPreviewHandler,
    setupProviderSelectorPreviewHandlers,
  } from '../../../../test/catalog-preview-ipc';

  function setupPickerProviders() {
    const restoreProviders = setupPreviewProviders();
    const unavailable = { available: false };
    const restoreAvailability = setupProviderSelectorPreviewHandlers({
      hasAnyProvider: true,
      hiddenProviders: [],
      providers: {
        codex: { available: true, authenticated: true },
        claudeCode: unavailable,
        auggie: unavailable,
        cortex: unavailable,
        mock: unavailable,
        opencode: unavailable,
        pi: unavailable,
        droid: unavailable,
        grok: unavailable,
        unsloth: unavailable,
      },
    });
    const restoreModels = setupModelPickerPreviewHandler('codex', [
      { value: 'fixture-model', label: 'Fixture model' },
    ]);
    return () => {
      restoreModels();
      restoreAvailability();
      restoreProviders();
    };
  }

  function startOnMachine(id: string, name: string, state: RemoteMachineState): RemoteMachine {
    return {
      id,
      name,
      platform: { os: 'macos', arch: 'aarch64' },
      hosts: ['192.0.2.4'],
      port: 5179,
      fingerprint: `fp-${id}`,
      state,
      runningAgents: 0,
      capabilities: {
        providers: [{ id: 'codex', status: 'ready', models: ['fixture-model'] }],
      },
      observedAt: new Date(catalogNow()).toISOString(),
      addedAt: '2026-11-01T00:00:00Z',
    };
  }

  /** Labs on, a backend advertising remoteInitialAgent, and the scene's machines. */
  function setupStartOnFixture(scenario: string) {
    const before = store.state;
    const previousLabs = before.userPreferences?.labsRemoteAgentsEnabled === true;
    const previousConnections = selectConnections.select(before);
    store.dispatch(
      connectionsListReceived({
        connections: [
          {
            id: 'intent1',
            label: 'intent1',
            host: '192.0.2.1',
            port: 5179,
            fingerprint: 'AA:01',
            isLocal: false,
            status: 'connected',
            // The backend's own host.status platform: its row gets a subtitle too.
            hostOs: 'linux',
            hostArch: 'x86_64',
          },
        ],
        activeId: 'intent1',
        windowBackendId: 'intent1',
      }),
    );
    store.dispatch(setLabsRemoteAgentsEnabled(true));
    // A catalog with remote-compatibility fields: the backend switches remote models.
    store.dispatch(
      providerCatalogLoaded({
        providers: selectProviderCatalogEntries.select(store.state),
        defaultRemoteIncompatibility: {},
      }),
    );
    store.dispatch(
      remoteMachinesLoaded({
        supported: true,
        initialAgentPlacement: true,
        machines:
          scenario === 'start-on-none'
            ? []
            : [
                startOnMachine('d-mac', 'Mac mini', 'connected'),
                ...(scenario === 'start-on-unreachable'
                  ? [startOnMachine('d-lab', 'Lab PC', 'unreachable')]
                  : []),
              ],
        localFingerprint: null,
        executorBackends: null,
      }),
    );
    return () => {
      store.dispatch(setLabsRemoteAgentsEnabled(previousLabs));
      store.dispatch(backendReconnected());
      store.dispatch(
        connectionsListReceived({
          connections: previousConnections,
          activeId: before.connections.activeId,
          windowBackendId: before.connections.windowBackendId,
        }),
      );
    };
  }

  interface Props {
    state?:
      | 'populated'
      | 'orchestration'
      | 'sidebar'
      | 'empty'
      | 'compact'
      | 'welcome'
      | 'crowded'
      | 'builtin'
      | 'start-on-none'
      | 'start-on-machine'
      | 'start-on-unreachable'
      | 'start-on-open';
  }
  export const preview = definePreview<Props>({
    id: 'initial-agent-picker',
    title: 'Initial agent picker',
    defaultState: 'populated',
    states: {
      builtin: { props: { state: 'builtin' } },
      populated: { props: { state: 'populated' } },
      orchestration: { props: { state: 'orchestration' } },
      sidebar: { props: { state: 'sidebar' } },
      empty: { props: { state: 'empty' } },
      compact: { props: { state: 'compact' } },
      welcome: { props: { state: 'welcome' } },
      crowded: { props: { state: 'crowded' } },
      // New Workspace → Start On (remote initial agent).
      'start-on-none': { props: { state: 'start-on-none' } },
      'start-on-machine': { props: { state: 'start-on-machine' } },
      'start-on-unreachable': { props: { state: 'start-on-unreachable' } },
      // The open machine list: backend and machine rows both show their platform.
      'start-on-open': { props: { state: 'start-on-open' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { SPECIALISTS } from '$lib/constants/specialists';
  import StartOnPicker from './StartOnPicker.svelte';
  import { selectStartOnOptions } from '$features/remote-machines/remote-machines-selectors';
  import InitialAgentPicker from './InitialAgentPicker.svelte';
  import SpecialistDropdown from '$lib/components/chat/SpecialistDropdown.svelte';
  import RegularAgentWelcome from '$lib/components/chat/RegularAgentWelcome.svelte';
  import type { AgentSession } from '$shared/types/agent-session';
  import {
    setFileSpecialists,
    setFileSpecialistsLoaded,
    setCustomSpecialistsLoaded,
  } from '$store/renderer/slices/specialists/specialists-slice';
  import {
    selectFileSpecialists,
    selectFileSpecialistsLoaded,
    selectCustomSpecialistsLoaded,
  } from '$store/renderer/slices/specialists/specialists-selectors';

  let { state: scenario = 'populated' }: Props = $props();
  let selected = $state<string | null>(
    untrack(() => (scenario === 'welcome' ? 'fixture-developer' : null)),
  );
  let teamMode = $state(untrack(() => scenario === 'orchestration'));
  const welcomeSession = $derived({
    id: 'fixture-welcome-agent',
    backendSessionId: null,
    metadata: { specialist: selected },
  } as AgentSession);
  onDestroy(setupPickerProviders());
  const startOn = untrack(() => scenario.startsWith('start-on-'));
  let startOnMachineId = $state(untrack(() => (scenario === 'start-on-machine' ? 'd-mac' : '')));
  if (startOn) onDestroy(setupStartOnFixture(untrack(() => scenario)));
  const startOnOptions$ = selectStartOnOptions();
  // Enough rows to overflow the specialist menu's height cap.
  const crowdedSpecialists = () =>
    Array.from({ length: 8 }, (_, index) => ({
      id: `fixture-crowded-${index + 1}`,
      name: `Crowded specialist ${index + 1}`,
      description: 'Keeps a steady pipeline of evidence-backed fixes across components.',
      model: 'fixture-model',
      codingAgent: 'codex',
      behaviorPrompt: '',
      filePath: `/fixture/crowded-${index + 1}.md`,
      source: 'user' as const,
      icon: 'developer',
    }));
  const previousFiles = selectFileSpecialists.select(store.state);
  const previousFilesLoaded = selectFileSpecialistsLoaded.select(store.state);
  const previousCustomLoaded = selectCustomSpecialistsLoaded.select(store.state);
  store.dispatch(
    setFileSpecialists(
      untrack(() =>
        scenario === 'builtin'
          ? SPECIALISTS.map((specialist) => ({
              ...specialist,
              model: '',
              behaviorPrompt: specialist.defaultBehaviorPrompt,
              filePath: `/fixture/${specialist.id}.md`,
              source: 'user' as const,
            }))
          : scenario === 'empty'
            ? []
            : [
                {
                  id: 'fixture-developer',
                  name: 'Developer',
                  description: 'Builds and verifies focused changes.',
                  model: 'fixture-model',
                  codingAgent: 'codex',
                  behaviorPrompt:
                    '## Developer\n\nWork on one focused task at a time.\n\nInspect the relevant components before changing them.\n\nUse the existing design system.\n\nPreserve keyboard and pointer behavior.\n\nVerify narrow and wide layouts.\n\nRun focused tests and report the results.',
                  filePath: '/fixture/developer.md',
                  source: 'user',
                  icon: 'developer',
                },
                {
                  id: 'fixture-long',
                  name: 'A specialist with a very long descriptive name',
                  description:
                    'Investigates difficult rendering problems and verifies accessible behavior in narrow application panels.',
                  model: 'fixture-model',
                  codingAgent: 'codex',
                  behaviorPrompt: '',
                  filePath: '/fixture/long.md',
                  source: 'user',
                  icon: 'reviewer',
                },
                {
                  id: 'fixture-coordinator',
                  name: 'Coordinator',
                  description: 'Plans the work and delegates it.',
                  model: 'fixture-model',
                  codingAgent: 'codex',
                  behaviorPrompt: '',
                  filePath: '/fixture/coordinator.md',
                  source: 'user',
                  icon: 'coordinator',
                  role: 'orchestrator',
                },
                ...(scenario === 'crowded' ? crowdedSpecialists() : []),
              ],
      ),
    ),
  );
  store.dispatch(setCustomSpecialistsLoaded(true));
  store.dispatch(setFileSpecialistsLoaded(true));
  onDestroy(() => {
    store.dispatch(setFileSpecialists(previousFiles));
    store.dispatch(setFileSpecialistsLoaded(previousFilesLoaded));
    store.dispatch(setCustomSpecialistsLoaded(previousCustomLoaded));
  });
</script>

<section
  class="w-full min-w-0 p-4 {scenario === 'sidebar' ? 'max-w-[300px]' : ''} {scenario ===
  'start-on-open'
    ? 'min-h-[420px]'
    : ''}"
  data-testid="specialist-fixture"
>
  {#if scenario === 'compact'}
    <SpecialistDropdown value={selected} onchange={(value) => (selected = value)} />
  {:else if scenario === 'welcome'}
    <RegularAgentWelcome
      session={welcomeSession}
      onSpecialistChange={(value) => (selected = value)}
    />
  {:else if scenario === 'start-on-open'}
    <StartOnPicker
      open
      value={startOnMachineId}
      options={$startOnOptions$}
      onChange={(id) => (startOnMachineId = id)}
    />
  {:else}
    <InitialAgentPicker
      bind:selectedSpecialist={selected}
      bind:isTeamMode={teamMode}
      bind:startOnMachineId
      selectedProvider="codex"
    />
  {/if}
  <output class="sr-only" data-testid="specialist-selection"
    >{teamMode ? 'orchestration' : (selected ?? 'general')}</output
  >
</section>
