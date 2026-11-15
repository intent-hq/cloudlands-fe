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
    | 'dialogRefused';

  const state = (scenario: Scenario) => ({ props: { scenario } });
  export const preview = definePreview<{ scenario: Scenario }>({
    id: 'workspace-home',
    title: 'Workspace home: header line, banner, card marker, panels and Move home',
    defaultState: 'detached',
    states: {
      attached: state('attached'),
      detached: state('detached'),
      // Collaborators can wait but not move the home.
      detachedCollaborator: state('detachedCollaborator'),
      moving: state('moving'),
      backupWarning: state('backupWarning'),
      dialog: state('dialog'),
      // The old home is detached: warn with the last backup time first.
      dialogWarning: state('dialogWarning'),
      dialogRefused: state('dialogRefused'),
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
  };
  const OPTIONS: MoveHomeOption[] = [
    {
      key: homeMoveTargetKey({ agentId: 'agent-review' }),
      kind: 'agent',
      label: 'Reviewer',
      machineName: 'Garage node',
      platform: null,
      disabled: false,
    },
    {
      key: homeMoveTargetKey({ agentId: 'agent-sandbox' }),
      kind: 'agent',
      label: 'Test runner with a long descriptive name',
      machineName: 'E2B · Team',
      platform: null,
      disabled: false,
    },
    {
      key: homeMoveTargetKey({ kind: 'machine', nodeId: 'd-mac-studio' }),
      kind: 'machine',
      label: 'Mac Studio',
      platform: 'macOS arm64',
      disabled: false,
    },
    {
      key: homeMoveTargetKey({ kind: 'machine', nodeId: 'd-garage' }),
      kind: 'machine',
      label: 'Garage node',
      platform: 'Linux x64',
      disabled: false,
    },
    {
      key: homeMoveTargetKey({ kind: 'machine', nodeId: 'd-old' }),
      kind: 'machine',
      label: 'Old laptop',
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
  ];

  const home = $derived(HOMES[scenario]);
  const view = $derived(workspaceHomeView({ home }));
  const canMove = $derived(scenario !== 'detachedCollaborator' && view?.canMove === true);
  const dialog = $derived(scenario.startsWith('dialog'));
</script>

{#if dialog && view}
  <div class="relative min-h-205 w-full">
    <MoveHomeDialog
      open
      static
      {view}
      options={OPTIONS}
      currentKey={homeMoveTargetKey({ kind: 'machine', nodeId: 'd-mac-studio' })}
      initialKey={scenario === 'dialogRefused'
        ? homeMoveTargetKey({ kind: 'machine', nodeId: 'd-garage' })
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
      class="flex h-115 w-full min-w-0 flex-col overflow-hidden rounded-(--radius-large) border border-border"
      data-workspace-home-preview
    >
      <div class="flex flex-col gap-1 border-b border-border px-4 py-3">
        <p class="type-title">Ship the importer</p>
        <WorkspaceHomeLine {view} />
      </div>
      <WorkspaceHomeBanner {view} {canMove} />
      <div class="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-2">
        <div class="flex flex-col gap-3 border-border p-4 sm:border-r">
          <p class="type-caption text-muted-foreground">Coordinator</p>
          <div class="max-w-4/5 self-end rounded-(--radius-medium) bg-muted px-3 py-2 type-body">
            Chats keep working while the home is away.
          </div>
        </div>
        <div class="min-h-0 border-t border-border sm:border-t-0">
          {#if view.unavailable}
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
