<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    state?:
      | 'empty'
      | 'uninitialized'
      | 'loading'
      | 'error'
      | 'ready'
      | 'refreshing'
      | 'page-error'
      | 'detecting';
    longContent?: boolean;
    scriptCount?: number;
    terminalCount?: number;
    short?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'terminal-sidebar',
    title: 'Terminal sidebar',
    defaultState: 'load-error',
    states: {
      'load-error': { props: { state: 'error' } },
      uninitialized: { props: { state: 'uninitialized' } },
      loading: { props: { state: 'loading' } },
      empty: { props: { state: 'empty' } },
      detecting: { props: { state: 'detecting' } },
      populated: { props: { state: 'ready' } },
      refreshing: { props: { state: 'refreshing' } },
      'pagination-error': { props: { state: 'page-error' } },
      'long-content': { props: { state: 'page-error', longContent: true } },
      'no-terminals': { props: { terminalCount: 0 } },
      'short-many': { props: { state: 'ready', scriptCount: 12, terminalCount: 12, short: true } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import TerminalSidebar from './TerminalSidebar.svelte';
  import { observeSidebarRefresh } from './terminal-sidebar.preview-fixtures';
  import { store } from '$store/renderer/store';
  import {
    setScriptListState,
    setScriptPageCursor,
    setScriptsData,
    setScriptsInitialized,
  } from '$store/renderer/slices/scripts/scripts-slice';
  import {
    loadWorkspaceTerminals,
    selectTerminal,
  } from '$store/renderer/slices/terminals/terminals-slice';
  import { setExecutorState } from '$store/renderer/slices/background-agent-executor/background-agent-executor-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { m } from '$shared/paraglide/messages.js';
  import type { ScriptListEntry } from '$features/scripts/types';

  let {
    state: listState = 'empty',
    longContent = false,
    scriptCount = 3,
    terminalCount = 1,
    short = false,
  }: Props = $props();
  const workspaceId = 'preview-terminal-sidebar';
  const createdAt = '2026-10-19T12:00:00Z';
  let selectedScriptId = $state<string | null>(null);
  let retries = $state(0);
  onDestroy(observeSidebarRefresh(workspaceId, () => (retries += 1)));

  $effect(() => {
    const populated = ['ready', 'refreshing', 'page-error'].includes(listState);
    const error = listState === 'error' || listState === 'page-error';
    store.dispatch(
      setWorkspaceEntity({
        id: workspaceId,
        title: 'Terminal sidebar',
        path: '/tmp/preview-terminal-sidebar',
      } as never),
    );
    const scripts: ScriptListEntry[] = populated
      ? Array.from({ length: scriptCount }, (_, index) => ({
          id: `preview-script-${index}`,
          workspaceId,
          name: longContent
            ? `Validate workspace configuration and deployment settings ${index + 1}`
            : ['Dev server', 'Build', 'Lint'][index % 3],
          command: ['pnpm dev', 'pnpm build', 'pnpm lint'][index % 3],
          mode: index === 0 ? 'service' : 'command',
          source: 'user',
          createdAt,
          runtime: { status: index === 0 ? 'running' : 'idle', restartCount: 0 },
        }))
      : [];
    store.dispatch(setScriptsData(workspaceId, scripts));
    store.dispatch(
      setScriptsInitialized(workspaceId, listState !== 'uninitialized' && listState !== 'loading'),
    );
    store.dispatch(
      setScriptListState(
        workspaceId,
        listState === 'loading' || listState === 'refreshing',
        error
          ? longContent
            ? `Unable to load /workspace/packages/console/configuration/development/scripts/manifest.json. ${m.scripts_list_unsupported_error()}`
            : m.scripts_list_unsupported_error()
          : undefined,
      ),
    );
    store.dispatch(setScriptPageCursor(workspaceId, populated ? 'preview-next-page' : undefined));
    store.dispatch(
      setExecutorState(workspaceId, 'script-detect', {
        status: listState === 'detecting' ? 'running' : 'idle',
        agentId: null,
      }),
    );
    const terminals = Array.from({ length: terminalCount }, (_, index) => ({
      id: `preview-terminal-${index}`,
      name: longContent
        ? `Terminal for console development and deployment ${index + 1}`
        : index === 0
          ? 'Terminal'
          : `Terminal ${index + 1}`,
      workspaceId,
      createdAt,
    }));
    store.dispatch(
      loadWorkspaceTerminals(
        workspaceId,
        terminals,
        { isOpen: true, activeTerminalId: terminals[0]?.id ?? null },
        'preview-terminal-boot',
      ),
    );
  });
</script>

<div
  data-testid="terminal-sidebar-preview"
  data-retries={retries}
  class="w-full bg-sidebar text-foreground"
  class:h-64={short}
  class:h-96={!short}
>
  <TerminalSidebar
    {workspaceId}
    {selectedScriptId}
    onSelectScript={(id) => (selectedScriptId = id)}
    onSelectTerminal={(id) => store.dispatch(selectTerminal(workspaceId, id))}
    class="w-full! border-l-0"
  />
</div>
