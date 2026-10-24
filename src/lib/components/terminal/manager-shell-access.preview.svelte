<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    initializeStore?: boolean;
    role?: 'manager' | 'collaborator';
    target?: 'service' | 'command' | 'oneOff' | 'terminal';
    inspectHeader?: boolean;
  }
  export const preview = definePreview<Props>({
    id: 'manager-shell-access',
    title: 'Manager saved-script access',
    defaultState: 'manager',
    states: {
      manager: { props: {} },
      'idle-command': { props: { target: 'command' } },
      participant: { props: { role: 'collaborator' } },
      'one-off-denied': { props: { target: 'oneOff' } },
      'raw-terminal-denied': { props: { target: 'terminal' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import WorkspaceShellList from '../workspace/WorkspaceShellList.svelte';
  import TerminalTabType from '$features/layout/tab-types/TerminalTabType.svelte';
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import { selectWorkspaceScriptOperations } from '$store/renderer/slices/scripts/scripts-selectors';
  import {
    managerShellWorkspace as workspaceId,
    managerShellScripts,
    managerShellTerminal,
    seedManagerShellAccess,
    setManagerShellRole,
  } from './manager-shell-access.preview-fixtures';

  let {
    role = 'manager',
    target = 'service',
    inspectHeader = false,
    initializeStore = false,
  }: Props = $props();
  const disposeStore = untrack(() => initializeStore)
    ? startRootStoreLifecycle(store, { startSagas: () => [] })
    : () => {};
  onDestroy(disposeStore);
  seedManagerShellAccess();
  $effect(() => setManagerShellRole(role));
  const operations = selectWorkspaceScriptOperations(workspaceId);
  const header = createPanelHeaderContext();
  const title = $derived(
    target === 'command'
      ? 'Check project'
      : target === 'service'
        ? 'Preview server'
        : 'Unavailable output',
  );
  const tab = $derived({
    id: 'manager-output-tab',
    type: 'terminal' as const,
    title,
    workspaceId,
    closable: true,
    ...(target === 'terminal'
      ? { terminalId: managerShellTerminal }
      : { scriptId: managerShellScripts[target] }),
  });
</script>

<div
  class="w-full bg-background text-foreground"
  data-testid="manager-shell-access"
  data-operations={JSON.stringify($operations)}
>
  <header class="border-b border-border px-4 py-3">
    <h2 class="text-sm font-medium">Intent Site</h2>
    <p class="text-xs text-muted-foreground">
      {role === 'manager' ? 'Manager' : 'Participant'} · Shell
    </p>
  </header>
  <div class="grid min-h-[420px] grid-cols-1 sm:grid-cols-[240px_minmax(0,1fr)]">
    <section
      class="border-b border-border py-3 sm:border-b-0 sm:border-r"
      aria-label="Workspace shell"
    >
      <WorkspaceShellList {workspaceId} />
    </section>
    <section class="flex min-w-0 flex-col" aria-label="Script output">
      <div class="border-b border-border px-4 py-3 text-sm font-medium">{title}</div>
      {#if inspectHeader}
        <Menu.Root>
          <Menu.Trigger aria-label="Inspect panel actions">Inspect panel actions</Menu.Trigger>
          <Menu.Content>{@render header.actions.current?.actions?.()}</Menu.Content>
        </Menu.Root>
      {/if}
      <div class="h-80 min-w-0 flex-1">
        <TerminalTabType {tab} {workspaceId} isActive={true} isPanelFocused={true} />
      </div>
    </section>
  </div>
</div>
