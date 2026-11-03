<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    remote?: 'running' | 'exited' | 'lost' | 'service';
    supported?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'remote-scripts',
    title: 'Remote agent machine runs',
    defaultState: 'running',
    states: {
      running: { props: { remote: 'running' } },
      exited: { props: { remote: 'exited' } },
      lost: { props: { remote: 'lost' } },
      service: { props: { remote: 'service' } },
      'older-backend': { props: { remote: 'service', supported: false } },
    },
  });
</script>

<script lang="ts">
  import TerminalSidebar from '$lib/components/terminal/TerminalSidebar.svelte';
  import QuakeTerminalOverlay from '$lib/components/terminal/QuakeTerminalOverlay.svelte';
  import { store } from '$store/renderer/store';
  import { AgentStatus, WorkspaceStatus, type AgentSession } from '$shared/types';
  import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
  import { parsePrincipalSnapshot } from '$shared/types/principal';
  import type { ScriptListEntry } from '$features/scripts/types';
  import { bulkUpsertSessions } from '$store/renderer/slices/agent-session/agent-session-slice';
  import {
    principalContextChanged,
    principalReceived,
  } from '$store/renderer/slices/principal/principal-slice';
  import {
    setScriptsData,
    setScriptsInitialized,
    setScriptListState,
  } from '$store/renderer/slices/scripts/scripts-slice';
  import { loadWorkspaceTerminals } from '$store/renderer/slices/terminals/terminals-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';

  let { remote = 'running', supported = true }: Props = $props();
  const workspaceId = 'preview-remote-scripts';
  const createdAt = '2026-11-03T08:00:00Z';
  const scriptId = 'preview-remote-script';

  store.dispatch(
    setWorkspaceEntity({
      id: WorkspaceId(workspaceId),
      title: 'Remote scripts',
      branch: 'preview',
      path: '/preview/project',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatus.Active,
      createdAt,
      updatedAt: createdAt,
    }),
  );
  store.dispatch(
    bulkUpsertSessions(
      [
        {
          id: AgentId('preview-remote-agent'),
          backendSessionId: null,
          workspaceId: WorkspaceId(workspaceId),
          name: 'Remote worker',
          status: AgentStatus.Idle,
          messages: [],
          createdAt,
          updatedAt: createdAt,
          nodeId: 'preview-node-mac',
          nodeName: 'Mac Studio',
          placement: { target: 'remote', checkout: 'isolated', os: 'macos', arch: 'aarch64' },
        } as unknown as AgentSession,
      ],
      { preserveExplicitRuntimeFlags: true },
    ),
  );

  $effect(() => {
    store.dispatch(principalContextChanged('preview-remote-scripts'));
    const { invalidation, presentationVersion } = store.state.principal;
    const snapshot = parsePrincipalSnapshot(
      { server: { capabilities: supported ? { remoteScripts: 1 } : {} } },
      { id: 'preview', login: null, displayName: null, avatarUrl: null, isAdministrator: true },
    );
    if (snapshot)
      store.dispatch(
        principalReceived(
          { context: 'preview-remote-scripts', invalidation, presentationVersion },
          snapshot,
        ),
      );
  });

  $effect(() => {
    const runtime: ScriptListEntry['runtime'] =
      remote === 'exited'
        ? { status: 'exited', exitCode: 0, restartCount: 0, stoppedAt: createdAt }
        : remote === 'lost'
          ? {
              status: 'exited',
              exitCode: -1,
              restartCount: 0,
              error: 'remote-script-lost: the machine disconnected',
            }
          : remote === 'service'
            ? { status: 'running', restartCount: 0, detectedUrl: 'http://localhost:5173' }
            : { status: 'running', restartCount: 0, pid: 4242 };
    const service = remote === 'service';
    store.dispatch(
      setScriptsData(workspaceId, [
        {
          id: 'preview-local-build',
          workspaceId,
          name: 'build',
          command: 'pnpm build',
          mode: 'command',
          source: 'user',
          createdAt,
          runtime: { status: 'idle', restartCount: 0 },
        },
        {
          id: scriptId,
          workspaceId,
          name: service ? 'dev server' : 'ios tests',
          command: service ? 'pnpm dev' : 'xcodebuild test',
          mode: service ? 'service' : 'command',
          source: 'user',
          createdAt,
          runtime: service
            ? { status: 'running', restartCount: 0, detectedUrl: 'http://localhost:3000' }
            : { status: 'idle', restartCount: 0 },
          machineRuns: [
            { remoteAgentId: 'preview-remote-agent', nodeId: 'preview-node-mac', runtime },
          ],
        },
      ]),
    );
    store.dispatch(setScriptsInitialized(workspaceId, true));
    store.dispatch(setScriptListState(workspaceId, false, undefined));
    store.dispatch(
      loadWorkspaceTerminals(
        workspaceId,
        [{ id: 'preview-terminal', name: 'Terminal', workspaceId }],
        { isOpen: true, activeTerminalId: 'preview-terminal', selectedScriptId: scriptId },
        'preview-boot',
      ),
    );
  });
</script>

<div class="relative flex h-[560px] w-full gap-6 bg-background p-6 text-foreground">
  <section class="w-64 min-w-0">
    <h2 class="mb-4 px-3 type-caption text-muted-foreground">Bottom-pane scripts</h2>
    <div class="flex h-80">
      <TerminalSidebar {workspaceId} selectedScriptId={scriptId} />
    </div>
  </section>
  <section class="relative min-w-0 flex-1">
    <QuakeTerminalOverlay {workspaceId} />
  </section>
</div>
