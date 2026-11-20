<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    populated?: boolean;
    loadError?: boolean;
    autoStart?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'terminal-scripts',
    title: 'Terminal script discovery',
    defaultState: 'empty',
    states: {
      empty: { props: {} },
      populated: { props: { populated: true } },
      'auto-start': { props: { populated: true, autoStart: true } },
      error: { props: { loadError: true } },
    },
  });
</script>

<script lang="ts">
  import WorkspaceShellList from '$lib/components/workspace/WorkspaceShellList.svelte';
  import TerminalSidebar from '$lib/components/terminal/TerminalSidebar.svelte';
  import { store } from '$store/renderer/store';
  import {
    setScriptsData,
    setScriptsInitialized,
    setScriptListState,
  } from '$store/renderer/slices/scripts/scripts-slice';
  import { loadWorkspaceTerminals } from '$store/renderer/slices/terminals/terminals-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { m } from '$shared/paraglide/messages.js';
  import { WorkspaceStatus } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';

  let { populated = false, loadError = false, autoStart = false }: Props = $props();
  const workspaceId = 'preview-terminal-scripts';
  const createdAt = '2026-10-18T00:00:00Z';

  store.dispatch(
    setWorkspaceEntity({
      id: WorkspaceId(workspaceId),
      title: 'Terminal scripts',
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
    loadWorkspaceTerminals(
      workspaceId,
      [{ id: 'preview-terminal', name: 'Terminal', workspaceId }],
      { isOpen: false, activeTerminalId: 'preview-terminal', selectedScriptId: null },
      'preview-boot',
    ),
  );
  $effect(() => {
    store.dispatch(
      setScriptsData(
        workspaceId,
        populated
          ? [...['dev', 'build', 'test', 'check'], ...(autoStart ? ['api', 'storybook'] : [])].map(
              (name) => ({
                id: `preview-${name}`,
                workspaceId,
                name,
                command: `pnpm ${name}`,
                mode: ['dev', 'api', 'storybook'].includes(name) ? 'service' : 'command',
                source: 'auto-detected',
                createdAt,
                ...(name === 'api' || name === 'storybook' ? { autoStart: true } : {}),
                runtime: {
                  status: name === 'dev' || name === 'storybook' ? 'running' : 'idle',
                  restartCount: 0,
                },
              }),
            )
          : [],
      ),
    );
    store.dispatch(setScriptsInitialized(workspaceId, true));
    store.dispatch(
      setScriptListState(
        workspaceId,
        false,
        loadError ? m.scripts_list_unsupported_error() : undefined,
      ),
    );
  });
</script>

<div class="flex flex-wrap items-start gap-8 bg-background p-6 text-foreground">
  <section class="w-64 min-w-0">
    <h2 class="mb-4 px-2 type-caption text-muted-foreground">Workspace sidebar</h2>
    <WorkspaceShellList {workspaceId} />
  </section>
  <section class="min-w-0">
    <h2 class="mb-4 px-3 type-caption text-muted-foreground">Bottom-pane scripts</h2>
    <div class="flex h-80">
      <TerminalSidebar {workspaceId} />
    </div>
  </section>
</div>
