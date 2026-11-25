<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Scenario =
    | 'attached'
    | 'detached'
    | 'detachedCollaborator'
    | 'moving'
    | 'backupWarning'
    | 'dialog'
    | 'dialogWarning'
    | 'dialogRefused'
    | 'starting'
    | 'startingTerminal'
    | 'startingToAttached'
    | 'dialogCloud'
    | 'dialogCloudSelected'
    | 'dialogCloudWarning'
    | 'openingPreparing'
    | 'openingRunning'
    | 'openingOutput'
    | 'openingReady'
    | 'openFailed'
    | 'setupFailed'
    | 'setupFailedOutput'
    | 'setupTimedOut';

  const scenarioState = (scenario: Scenario) => ({ props: { scenario } });
  export const preview = definePreview<{ scenario: Scenario }>({
    id: 'workspace-home',
    title: 'Workspace home: header line, banner, card marker, panels and Move home',
    defaultState: 'detached',
    states: {
      attached: scenarioState('attached'),
      detached: scenarioState('detached'),
      // Collaborators can wait but not move the home.
      detachedCollaborator: scenarioState('detachedCollaborator'),
      moving: scenarioState('moving'),
      backupWarning: scenarioState('backupWarning'),
      dialog: scenarioState('dialog'),
      // The old home is detached: warn with the last backup time first.
      dialogWarning: scenarioState('dialogWarning'),
      dialogRefused: scenarioState('dialogRefused'),
      // A cloud home's sandbox is starting: calm notice, no banner or actions.
      starting: scenarioState('starting'),
      // A shell terminal waits; a saved script's output stays readable, Run waits.
      startingTerminal: scenarioState('startingTerminal'),
      // The same panel before and after the home is attached (it retries).
      startingToAttached: scenarioState('startingToAttached'),
      // Machines and cloud entries together; an unusable entry shows its reason.
      dialogCloud: scenarioState('dialogCloud'),
      // A cloud entry chosen: Move home is enabled.
      dialogCloudSelected: scenarioState('dialogCloudSelected'),
      // The old home is unavailable and the target is a cloud entry.
      dialogCloudWarning: scenarioState('dialogCloudWarning'),
      // nodes.md "Opening the home": the machine fetches and checks out.
      openingPreparing: scenarioState('openingPreparing'),
      // The workspace setup script runs in the new home checkout.
      openingRunning: scenarioState('openingRunning'),
      // The same, with its output open.
      openingOutput: scenarioState('openingOutput'),
      // Setup completed: the banner is gone.
      openingReady: scenarioState('openingReady'),
      // The machine could not make the checkout: reason, Move home, output.
      openFailed: scenarioState('openFailed'),
      // The setup script exited non-zero; the home still works.
      setupFailed: scenarioState('setupFailed'),
      // The same, with its output open.
      setupFailedOutput: scenarioState('setupFailedOutput'),
      // The setup script timed out.
      setupTimedOut: scenarioState('setupTimedOut'),
    },
  });
</script>

<script lang="ts">
  import type { WorkspaceHome } from '$shared/types/workspace-home';
  import WorkspaceHomeBanner from './components/WorkspaceHomeBanner.svelte';
  import WorkspaceHomeLine from './components/WorkspaceHomeLine.svelte';
  import WorkspaceHomeMarker from './components/WorkspaceHomeMarker.svelte';
  import WorkspaceHomePanelNotice from './components/WorkspaceHomePanelNotice.svelte';
  import MoveHomeDialog from './components/MoveHomeDialog.svelte';
  import { Button } from '$lib/components/ui/button';
  import { homeMoveTargetKey, workspaceHomeView, type MoveHomeOption } from './workspace-home';
  import { moveHomeFailureText } from './workspace-home-copy';

  let { scenario = 'detached' }: { scenario?: Scenario } = $props();

  const BASE: WorkspaceHome = {
    homeId: 'h-1',
    nodeId: 'd-mac-studio',
    name: 'Mac Studio',
    state: 'attached',
    since: '2026-11-12T09:00:00Z',
    lastBackupAt: '2026-11-12T09:41:00Z',
  };
  const SOURCE_SAMPLE =
    'src/importer.ts\nexport function importCsv(path: string) {\n  return readRows(path);\n}';
  const SCRIPT_SAMPLE =
    "$ pnpm build\nvite building for production...\nerror src/importer.ts: Cannot find module './rows'";
  const CLOUD_STARTING: WorkspaceHome = {
    homeId: 'h-3',
    cloudMachineId: 'e2b-team',
    name: 'E2B · Team',
    state: 'starting',
    since: '2026-11-15T09:00:00Z',
    lastBackupAt: '2026-11-15T08:41:00Z',
  };
  const OPENING: WorkspaceHome = { ...BASE, lastBackupAt: undefined };
  const SETUP_OUTPUT =
    'Fetching refs/intent/ws/ws-1/home/head\nChecking out 3f9c2ab (main)\n$ ./scripts/setup.sh\npnpm install --frozen-lockfile\nLockfile is up to date, resolution step is skipped\nPackages: +1342\n';
  const SETUP_FAILED_OUTPUT =
    SETUP_OUTPUT +
    'ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/@acme%2Fimporter: Not Found - 404\n';
  const HOMES: Record<Scenario, WorkspaceHome> = {
    attached: BASE,
    detached: { ...BASE, state: 'detached', since: '2026-11-12T09:42:00Z' },
    detachedCollaborator: { ...BASE, state: 'detached', since: '2026-11-12T09:42:00Z' },
    moving: {
      ...BASE,
      homeId: 'h-2',
      nodeId: 'd-garage',
      name: 'Garage node',
      state: 'moving',
      since: '2026-11-12T10:00:00Z',
    },
    backupWarning: { ...BASE, backupWarning: true },
    dialog: BASE,
    dialogWarning: { ...BASE, state: 'detached', since: '2026-11-12T09:42:00Z' },
    dialogRefused: BASE,
    starting: CLOUD_STARTING,
    startingTerminal: CLOUD_STARTING,
    startingToAttached: CLOUD_STARTING,
    dialogCloud: BASE,
    dialogCloudSelected: BASE,
    dialogCloudWarning: { ...BASE, state: 'detached', since: '2026-11-12T09:42:00Z' },
    openingPreparing: { ...OPENING, setup: { state: 'pending' } },
    openingRunning: {
      ...OPENING,
      setup: { state: 'running', startedAt: '2026-11-12T09:00:12Z' },
    },
    openingOutput: {
      ...OPENING,
      setup: { state: 'running', startedAt: '2026-11-12T09:00:12Z' },
    },
    openingReady: {
      ...OPENING,
      setup: {
        state: 'completed',
        exitCode: 0,
        startedAt: '2026-11-12T09:00:12Z',
        finishedAt: '2026-11-12T09:01:40Z',
      },
    },
    openFailed: {
      ...OPENING,
      setup: {
        state: 'failed',
        error:
          "node-checkout-failed: fetch refs/intent/ws/ws-1/home/head: could not reach the orchestrator's git endpoint",
        finishedAt: '2026-11-12T09:05:30Z',
      },
    },
    setupFailed: {
      ...OPENING,
      setup: {
        state: 'failed',
        exitCode: 1,
        startedAt: '2026-11-12T09:00:12Z',
        finishedAt: '2026-11-12T09:00:51Z',
      },
    },
    setupFailedOutput: {
      ...OPENING,
      setup: {
        state: 'failed',
        exitCode: 1,
        startedAt: '2026-11-12T09:00:12Z',
        finishedAt: '2026-11-12T09:00:51Z',
      },
    },
    setupTimedOut: {
      ...OPENING,
      setup: {
        state: 'failed',
        error: 'node-setup-timeout: the setup script ran longer than 30 minutes',
        startedAt: '2026-11-12T09:00:12Z',
        finishedAt: '2026-11-12T09:30:12Z',
      },
    },
  };
  const OPTIONS: MoveHomeOption[] = [
    {
      key: homeMoveTargetKey({ kind: 'machine', nodeId: 'd-mac-studio' }),
      kind: 'machine',
      label: 'Mac Studio',
      nodeId: 'd-mac-studio',
      agents: ['Coordinator'],
      platform: 'macOS arm64',
      disabled: false,
    },
    {
      key: homeMoveTargetKey({ kind: 'machine', nodeId: 'd-garage' }),
      kind: 'machine',
      label: 'Garage node',
      nodeId: 'd-garage',
      agents: ['Reviewer', 'Test runner with a long descriptive name'],
      platform: 'Linux x64',
      disabled: false,
    },
    {
      key: homeMoveTargetKey({ kind: 'machine', nodeId: 'd-old' }),
      kind: 'machine',
      label: 'Old laptop',
      nodeId: 'd-old',
      platform: 'macOS x64',
      disabled: true,
      reason: 'Needs an update',
    },
    {
      key: homeMoveTargetKey({ kind: 'cloud', cloudMachineId: 'e2b-team' }),
      kind: 'cloud',
      label: 'E2B · Team',
      platform: null,
      disabled: false,
    },
    {
      key: homeMoveTargetKey({ agentId: 'agent-sandbox' }),
      kind: 'agent',
      label: 'E2B · Team · sandbox',
      nodeId: 'cm-e2b-team-1',
      agents: ['Builder'],
      platform: null,
      disabled: false,
    },
  ];

  const CLOUD_ENTRY_KEY = homeMoveTargetKey({ kind: 'cloud', cloudMachineId: 'e2b-4x8' });
  const CLOUD_OPTIONS: MoveHomeOption[] = [
    {
      key: homeMoveTargetKey({ kind: 'machine', nodeId: 'd-mac-studio' }),
      kind: 'machine',
      label: 'Mac Studio',
      nodeId: 'd-mac-studio',
      platform: 'macOS arm64',
      disabled: false,
    },
    {
      key: homeMoveTargetKey({ kind: 'machine', nodeId: 'd-garage' }),
      kind: 'machine',
      label: 'Garage node',
      nodeId: 'd-garage',
      agents: ['Reviewer'],
      platform: 'Linux x64',
      disabled: false,
    },
    { key: CLOUD_ENTRY_KEY, kind: 'cloud', label: 'E2B 4x8', platform: null, disabled: false },
    {
      key: homeMoveTargetKey({ agentId: 'agent-tests' }),
      kind: 'agent',
      label: 'E2B 4x8 · sandbox',
      nodeId: 'cm-e2b-1',
      agents: ['Test runner'],
      platform: null,
      disabled: false,
    },
    {
      key: homeMoveTargetKey({ kind: 'cloud', cloudMachineId: 'northflank' }),
      kind: 'cloud',
      label: 'Northflank',
      platform: null,
      disabled: true,
      reason: 'Key rejected',
    },
  ];
  const cloudDialog = $derived(scenario.startsWith('dialogCloud'));
  let outputOpen = $state(false);
  $effect(() => {
    outputOpen = scenario === 'openingOutput' || scenario === 'setupFailedOutput';
  });
  const home = $derived(HOMES[scenario]);
  const view = $derived(workspaceHomeView({ home }));
  const canMove = $derived(scenario !== 'detachedCollaborator' && view?.canMove === true);
  const dialog = $derived(scenario.startsWith('dialog'));
  const attachedAfterStart = $derived(
    workspaceHomeView({
      home: { ...CLOUD_STARTING, state: 'attached', since: '2026-11-15T09:00:20Z' },
    }),
  );
</script>

{#if dialog && view}
  <div class="relative min-h-240 w-full">
    <MoveHomeDialog
      open
      static
      {view}
      options={cloudDialog ? CLOUD_OPTIONS : OPTIONS}
      currentKey={homeMoveTargetKey({ kind: 'machine', nodeId: 'd-mac-studio' })}
      currentNodeId="d-mac-studio"
      initialKey={scenario === 'dialogRefused'
        ? homeMoveTargetKey({ kind: 'machine', nodeId: 'd-garage' })
        : scenario === 'dialogCloudSelected' || scenario === 'dialogCloudWarning'
          ? CLOUD_ENTRY_KEY
          : ''}
      failureText={scenario === 'dialogRefused'
        ? moveHomeFailureText({ code: 'home-target-unavailable', message: '' })
        : null}
      onSubmit={() => {}}
      onCancel={() => {}}
    />
  </div>
{:else if view}
  <div class="flex w-full min-w-0 flex-col gap-4 bg-background p-4 text-foreground">
    <div
      class="flex w-full min-w-0 flex-col overflow-hidden rounded-(--radius-large) border border-border {scenario ===
      'startingTerminal'
        ? 'min-h-115'
        : 'h-115'}"
      data-workspace-home-preview
    >
      <div class="flex flex-col gap-1 border-b border-border px-4 py-3">
        <p class="type-title">Ship the importer</p>
        <WorkspaceHomeLine {view} />
      </div>
      <WorkspaceHomeBanner
        {view}
        {canMove}
        {outputOpen}
        output={scenario === 'setupFailedOutput' ? SETUP_FAILED_OUTPUT : SETUP_OUTPUT}
        onToggleOutput={() => (outputOpen = !outputOpen)}
        onDismiss={() => {}}
      />
      <div class="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-2">
        <div class="flex flex-col gap-3 border-border p-4 sm:border-r">
          <p class="type-caption text-muted-foreground">Coordinator</p>
          <div class="max-w-4/5 self-end rounded-(--radius-medium) bg-muted px-3 py-2 type-body">
            Chats keep working while the home is away.
          </div>
        </div>
        <div class="min-h-0 border-t border-border sm:border-t-0">
          {#if scenario === 'startingTerminal'}
            <div class="grid h-full min-h-80 grid-rows-2">
              <div class="min-h-0 border-b border-border">
                <p class="type-caption border-b border-border px-3 py-1.5 text-muted-foreground">
                  zsh
                </p>
                <WorkspaceHomePanelNotice {view} />
              </div>
              <div class="flex min-h-0 flex-col">
                <p class="type-caption border-b border-border px-3 py-1.5 text-muted-foreground">
                  build
                </p>
                <pre
                  class="type-code min-h-0 flex-1 overflow-hidden px-3 py-2 text-muted-foreground">{SCRIPT_SAMPLE}</pre>
                <div class="flex justify-end border-t border-border px-3 py-1.5">
                  <Button variant="ghost" size="compact" disabled>Run</Button>
                </div>
              </div>
            </div>
          {:else if scenario === 'startingToAttached' && attachedAfterStart}
            <div class="grid h-full grid-rows-2">
              <div class="flex min-h-0 flex-col border-b border-border">
                <p class="type-caption border-b border-border px-3 py-1.5 text-muted-foreground">
                  While the home starts
                </p>
                <WorkspaceHomePanelNotice {view} />
              </div>
              <div class="flex min-h-0 flex-col">
                <p class="type-caption border-b border-border px-3 py-1.5 text-muted-foreground">
                  Once attached: the panel reads again
                </p>
                <pre class="type-code min-h-0 p-4 text-muted-foreground">{SOURCE_SAMPLE}</pre>
              </div>
            </div>
          {:else if view.unavailable}
            <WorkspaceHomePanelNotice {view} {canMove} />
          {:else}
            <pre class="type-code h-full p-4 text-muted-foreground">src/importer.ts</pre>
          {/if}
        </div>
      </div>
    </div>
    <div
      class="flex min-w-0 items-center gap-2 rounded-(--radius-medium) border border-border px-3 py-2"
    >
      <span class="type-caption min-w-0 flex-1 truncate">Ship the importer</span>
      <WorkspaceHomeMarker workspace={{ home }} />
      <span class="type-caption text-muted-foreground">2m</span>
    </div>
  </div>
{/if}
