<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Scenario =
    | 'attached'
    | 'detached'
    | 'moving'
    | 'starting'
    | 'fileStarting'
    | 'fileMoving'
    | 'fileDetached';

  const state = (scenario: Scenario) => ({ props: { scenario } });
  export const preview = definePreview<{ scenario: Scenario }>({
    id: 'workspace-home-run',
    title: 'Workspace home: Run entry points and file read errors',
    defaultState: 'starting',
    states: {
      // Run in the Shells list, the scripts sidebar, the bottom overlay and a script panel.
      attached: state('attached'),
      detached: state('detached'),
      moving: state('moving'),
      starting: state('starting'),
      // A file read that failed with `home-unavailable` shows the reason the error carries.
      fileStarting: state('fileStarting'),
      fileMoving: state('fileMoving'),
      fileDetached: state('fileDetached'),
    },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ScriptWithState } from '$features/scripts/types';
  import type { WorkspaceHome } from '$shared/types/workspace-home';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { WorkspaceStatus } from '$shared/types';
  import { appClient } from '$lib/client';
  import { BackendError } from '$lib/client/live/backend-transport-types';
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import WorkspaceShellList from '$lib/components/workspace/WorkspaceShellList.svelte';
  import TerminalSidebar from '$lib/components/terminal/TerminalSidebar.svelte';
  import QuakeTerminalOverlay from '$lib/components/terminal/QuakeTerminalOverlay.svelte';
  import TerminalTabType from '$features/layout/tab-types/TerminalTabType.svelte';
  import FileTabType from '$features/layout/tab-types/FileTabType.svelte';
  import { store } from '$store/renderer/store';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import {
    setScriptsData,
    setScriptsInitialized,
  } from '$store/renderer/slices/scripts/scripts-slice';
  import { loadWorkspaceTerminals } from '$store/renderer/slices/terminals/terminals-slice';
  import { filesReadSaga } from '$store/renderer/slices/files/sagas/files-read-saga';
  import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';

  let { scenario = 'starting' }: { scenario?: Scenario } = $props();

  const createdAt = '2026-11-15T09:00:00Z';
  const HOMES: Record<'attached' | 'detached' | 'moving' | 'starting', WorkspaceHome> = {
    attached: {
      homeId: 'h-1',
      nodeId: 'd-mac-studio',
      name: 'Mac Studio',
      state: 'attached',
      since: createdAt,
      lastBackupAt: '2026-11-15T08:41:00Z',
    },
    detached: {
      homeId: 'h-1',
      nodeId: 'd-mac-studio',
      name: 'Mac Studio',
      state: 'detached',
      since: createdAt,
      lastBackupAt: '2026-11-15T08:41:00Z',
    },
    moving: {
      homeId: 'h-2',
      nodeId: 'd-garage',
      name: 'Garage node',
      state: 'moving',
      since: createdAt,
    },
    starting: {
      homeId: 'h-3',
      cloudMachineId: 'e2b-team',
      name: 'E2B · Team',
      state: 'starting',
      since: createdAt,
    },
  };
  // 09-error-codes.md: `home-unavailable` data for each file scenario.
  const FILE_ERRORS = {
    fileStarting: { name: 'E2B · Team', starting: true },
    fileMoving: { name: 'Garage node', moving: true },
    fileDetached: { name: 'Mac Studio', lastBackupAt: '2026-11-15T08:41:00Z' },
  } as const;

  const fileScenario = $derived(scenario in FILE_ERRORS);
  const workspaceId = $derived(`preview-home-run-${scenario}`);
  // TerminalTabType registers its header actions here.
  createPanelHeaderContext();

  const previous = {
    read: appClient.files.read,
    output: appClient.scripts.output,
    list: appClient.scripts.list,
  };
  appClient.files.read = async (ws) => {
    const key = ws.replace('preview-home-run-', '') as keyof typeof FILE_ERRORS;
    const data = { code: 'home-unavailable', retryable: true, ...FILE_ERRORS[key] };
    throw new BackendError({ code: 'INTERNAL', message: 'Internal error', rpcCode: -32603, data });
  };
  appClient.scripts.output = async () => '';
  appClient.scripts.list = async (ws) =>
    Object.values(store.state.scripts.byWorkspaceId[ws]?.scripts ?? {}).filter(
      (row): row is ScriptWithState => typeof row.command === 'string',
    );
  const stopFiles = store.runSaga(filesReadSaga);
  onDestroy(() => {
    stopFiles();
    Object.assign(appClient.files, { read: previous.read });
    Object.assign(appClient.scripts, { output: previous.output, list: previous.list });
  });
  admitLegacyPrincipal();

  $effect(() => {
    const id = workspaceId;
    const home = fileScenario ? HOMES.attached : HOMES[scenario as keyof typeof HOMES];
    store.dispatch(
      setWorkspaceEntity({
        id: WorkspaceId(id),
        title: 'Importer',
        branch: 'preview',
        path: '/preview/project',
        worktreePath: '/preview/project',
        changesets: [],
        timeline: [],
        conversationInfo: [],
        status: WorkspaceStatus.Active,
        createdAt,
        updatedAt: createdAt,
        myRole: 'owner',
        home,
      } as never),
    );
    store.dispatch(
      setScriptsData(
        id,
        ['dev', 'build'].map((name) => ({
          id: `preview-${name}`,
          workspaceId: id,
          name,
          command: `pnpm ${name}`,
          mode: name === 'dev' ? 'service' : 'command',
          source: 'user',
          createdAt,
          runtime: { status: name === 'dev' ? 'running' : 'idle', restartCount: 0 },
        })),
      ),
    );
    store.dispatch(setScriptsInitialized(id, true));
    store.dispatch(
      loadWorkspaceTerminals(
        id,
        [{ id: 'preview-terminal', name: 'Terminal', workspaceId: id }],
        { isOpen: true, activeTerminalId: null, selectedScriptId: 'preview-build' },
        'preview-boot',
      ),
    );
  });
</script>

{#key workspaceId}
  {#if fileScenario}
    <div class="h-[360px] w-full bg-background text-foreground" data-testid="home-run-file">
      <FileTabType
        tab={{
          id: 'file-tab',
          type: 'file',
          title: 'importer.ts',
          filePath: 'src/importer.ts',
          workspaceId,
          closable: true,
        }}
        {workspaceId}
        isActive={true}
        isPanelFocused={true}
      />
    </div>
  {:else}
    <div
      class="flex w-full flex-col gap-6 bg-background p-6 text-foreground"
      data-testid="home-run"
    >
      <div class="flex flex-wrap items-start gap-8">
        <section class="w-64 min-w-0">
          <h2 class="mb-4 px-2 type-caption text-muted-foreground">Shells list</h2>
          <WorkspaceShellList {workspaceId} />
        </section>
        <section class="min-w-0">
          <h2 class="mb-4 px-3 type-caption text-muted-foreground">Terminal sidebar</h2>
          <div class="flex h-48">
            <TerminalSidebar {workspaceId} />
          </div>
        </section>
        <section class="h-48 w-80 min-w-0">
          <h2 class="mb-4 px-3 type-caption text-muted-foreground">Script panel</h2>
          <TerminalTabType
            tab={{
              id: 'script-tab',
              type: 'terminal',
              title: 'build',
              scriptId: 'preview-build',
              workspaceId,
              closable: true,
            }}
            {workspaceId}
            isActive={true}
            isPanelFocused={true}
          />
        </section>
      </div>
      <section>
        <h2 class="mb-4 px-3 type-caption text-muted-foreground">Bottom overlay</h2>
        <div class="relative h-[320px] overflow-hidden rounded-md border border-border">
          <QuakeTerminalOverlay {workspaceId} />
        </div>
      </section>
    </div>
  {/if}
{/key}
