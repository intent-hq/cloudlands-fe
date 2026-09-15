<script lang="ts">
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import SidebarGroupHeader from './sidebar/SidebarGroupHeader.svelte';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { isLiveScriptStatus } from '$features/scripts/utils/script-status';
  import { Button } from '$lib/components/ui/button';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import {
    faArrowUpRightFromSquare,
    faExclamationTriangle,
    faWindowMaximize,
    faPlay,
    faRotateRight,
    faStop,
    faTableColumns,
  } from '$lib/icons/phosphor-icons';
  import {
    selectWorkspaceScriptEntries,
    selectWorkspaceScriptOperations,
  } from '$store/renderer/slices/scripts/scripts-selectors';
  import {
    restartScriptRequested,
    startScriptRequested,
    stopScriptRequested,
  } from '$store/renderer/slices/scripts/scripts-slice';
  import {
    selectActiveTerminalIdForWorkspace,
    selectTerminalsForWorkspace,
    selectWorkspaceTerminalState,
  } from '$store/renderer/slices/terminals/terminals-selectors';
  import {
    closeTerminalOverlay,
    openTerminalOverlay,
    selectScript,
    setTerminalPlacement,
  } from '$store/renderer/slices/terminals/terminals-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  let { workspaceId }: { workspaceId: string } = $props();
  const workspaceIdStore = writable('');
  $effect(() => workspaceIdStore.set(workspaceId));
  const terminals$ = selectTerminalsForWorkspace(workspaceIdStore);
  const activeTerminalId$ = selectActiveTerminalIdForWorkspace(workspaceIdStore);
  const scripts$ = selectWorkspaceScriptEntries(workspaceIdStore);
  const operations$ = selectWorkspaceScriptOperations(workspaceIdStore);
  const orderedScripts = $derived(
    $scripts$.toSorted(
      (left, right) =>
        Number(isLiveScriptStatus(right.runtime.status)) -
          Number(isLiveScriptStatus(left.runtime.status)) || left.name.localeCompare(right.name),
    ),
  );

  let terminalsExpanded = $state(true);
  let scriptsExpanded = $state(true);

  // Explicit surface actions override the remembered placement (the
  // `openTerminalOverlay` reducer records 'overlay' for the shown target).
  function showTerminalInOverlay(terminalId: string) {
    appStore.dispatch(openTerminalOverlay(workspaceId, terminalId));
  }

  function showScriptInOverlay(scriptId: string) {
    appStore.dispatch(selectScript(workspaceId, scriptId));
    appStore.dispatch(openTerminalOverlay(workspaceId));
  }

  // `openUserTab` activates an equivalent existing terminal/script tab
  // instead of opening a duplicate (see panel-tab-identity).
  function openTerminalInPanel(terminalId: string, title: string) {
    getPanelLayoutManager(workspaceId).openUserTab({
      type: 'terminal',
      title,
      terminalId,
      workspaceId,
      closable: true,
    });
    appStore.dispatch(setTerminalPlacement(workspaceId, terminalId, 'panel'));
    const state = selectWorkspaceTerminalState.select(appStore.state, workspaceId);
    if (state.isOpen && state.selectedScriptId === null && state.activeTerminalId === terminalId) {
      appStore.dispatch(closeTerminalOverlay(workspaceId));
    }
  }

  function openScriptInPanel(scriptId: string, title: string) {
    getPanelLayoutManager(workspaceId).openUserTab({
      type: 'terminal',
      title,
      scriptId,
      workspaceId,
      closable: true,
    });
    appStore.dispatch(setTerminalPlacement(workspaceId, scriptId, 'panel'));
    const state = selectWorkspaceTerminalState.select(appStore.state, workspaceId);
    if (state.isOpen && state.selectedScriptId === scriptId) {
      appStore.dispatch(closeTerminalOverlay(workspaceId));
    }
  }

  function runScript(scriptId: string, action: 'start' | 'stop' | 'restart', event: MouseEvent) {
    event.stopPropagation();
    const operation =
      action === 'start'
        ? startScriptRequested(workspaceId, scriptId)
        : action === 'stop'
          ? stopScriptRequested(workspaceId, scriptId)
          : restartScriptRequested(workspaceId, scriptId);
    appStore.dispatch(operation);
  }
</script>

<div class="flex min-w-0 flex-col gap-4 px-2" data-workspace-shell-list>
  <section>
    <SidebarGroupHeader
      title={m.terminal_sidebar_terminals_title()}
      expanded={terminalsExpanded}
      onclick={() => (terminalsExpanded = !terminalsExpanded)}
    />
    {#if terminalsExpanded}
      <div class="flex flex-col gap-0">
        {#each $terminals$ as terminal (terminal.id)}
          {@const active = terminal.id === $activeTerminalId$}
          {@const terminalName =
            terminal.customName || terminal.name || m.workspace_terminalDock_terminal_fallback()}
          <div
            class="group/terminal flex h-7 min-w-0 items-center gap-1 rounded-md px-2 hover:bg-muted focus-within:bg-muted"
            data-sidebar-shell-terminal={terminal.id}
            data-active={active || undefined}
          >
            <Button
              variant="plain"
              class="flex h-full min-w-0 flex-1 cursor-pointer items-center justify-start gap-2 px-0 py-0 text-left"
              onclick={() => openTerminalInPanel(terminal.id, terminalName)}
            >
              <span class="min-w-0 truncate text-sm font-medium text-foreground"
                >{terminalName}</span
              >
            </Button>
            <div class="flex shrink-0 items-center" data-surface-actions>
              <DropdownMenu align="end" side="bottom">
                {#snippet trigger({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon-compact"
                    iconOnly
                    class="size-7"
                    tooltip={m.workspace_shell_openIn_tooltip()}
                    tooltipSide="left"
                  >
                    <Fa icon={faArrowUpRightFromSquare} class="size-3" />
                  </Button>
                {/snippet}
                {#snippet content()}
                  <Menu.Item
                    onclick={(event) => {
                      event.stopPropagation();
                      openTerminalInPanel(terminal.id, terminalName);
                    }}
                  >
                    {#snippet leading()}<Fa icon={faTableColumns} class="size-3" />{/snippet}
                    {m.workspace_shell_showInPanel_tooltip()}
                  </Menu.Item>
                  <Menu.Item
                    onclick={(event) => {
                      event.stopPropagation();
                      showTerminalInOverlay(terminal.id);
                    }}
                  >
                    {#snippet leading()}<Fa
                        icon={faWindowMaximize}
                        class="size-3 rotate-180"
                      />{/snippet}
                    {m.workspace_shell_showInBottomBar_tooltip()}
                  </Menu.Item>
                {/snippet}
              </DropdownMenu>
            </div>
          </div>
        {:else}
          <p class="px-2 py-1.5 text-sm text-muted-foreground">
            {m.terminal_sidebar_noTerminals_label()}
          </p>
        {/each}
      </div>
    {/if}
  </section>
  <section>
    <SidebarGroupHeader
      title={m.workspace_devScripts_title()}
      expanded={scriptsExpanded}
      onclick={() => (scriptsExpanded = !scriptsExpanded)}
    />
    {#if scriptsExpanded}
      <div class="flex flex-col gap-0">
        {#each orderedScripts as script (script.id)}
          {@const live = isLiveScriptStatus(script.runtime.status)}
          {@const operation = $operations$[script.id]}
          {@const statusDescription = {
            running: m.workspace_devScripts_running_label(),
            restarting: m.workspace_devScripts_restarting_label(),
            exited: m.workspace_devScripts_exited_label(),
            idle: m.workspace_devScripts_idle_label(),
          }[script.runtime.status]}
          {@const errorLabel = operation?.error
            ? m.workspace_devScripts_actionFailed_error({
                name: script.name,
                error: operation.error,
              })
            : undefined}
          <div
            class="group/script flex h-7 min-w-0 items-center gap-1 rounded-md px-2 hover:bg-muted focus-within:bg-muted"
            data-sidebar-shell-script={script.id}
            data-live={live || undefined}
          >
            <Button
              variant="plain"
              class="flex h-full min-w-0 flex-1 cursor-pointer items-center justify-start gap-2 px-0 py-0 text-left"
              onclick={() => openScriptInPanel(script.id, script.name)}
            >
              <span
                class="size-2 shrink-0 rounded-full {live
                  ? 'bg-success'
                  : script.runtime.status === 'idle'
                    ? 'bg-muted-foreground/20'
                    : 'bg-muted-foreground/40'}"
                role="img"
                aria-label={statusDescription}
                title={statusDescription}
                data-script-status-indicator
              ></span>
              <span
                class="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
                title={script.name}
              >
                {script.name}
              </span>
            </Button>
            {#if errorLabel}
              <span
                class="flex shrink-0 items-center justify-center text-danger"
                role="alert"
                aria-label={errorLabel}
                title={errorLabel}
              >
                <Fa icon={faExclamationTriangle} class="size-3" />
              </span>
            {/if}
            <div class="flex shrink-0 items-center" data-surface-actions>
              <DropdownMenu align="end" side="bottom">
                {#snippet trigger({ props })}
                  <Button
                    {...props}
                    variant="ghost"
                    size="icon-compact"
                    iconOnly
                    class="size-7"
                    tooltip={m.workspace_shell_openIn_tooltip()}
                    tooltipSide="left"
                  >
                    <Fa icon={faArrowUpRightFromSquare} class="size-3" />
                  </Button>
                {/snippet}
                {#snippet content()}
                  <Menu.Item
                    onclick={(event) => {
                      event.stopPropagation();
                      openScriptInPanel(script.id, script.name);
                    }}
                  >
                    {#snippet leading()}<Fa icon={faTableColumns} class="size-3" />{/snippet}
                    {m.workspace_shell_showInPanel_tooltip()}
                  </Menu.Item>
                  <Menu.Item
                    onclick={(event) => {
                      event.stopPropagation();
                      showScriptInOverlay(script.id);
                    }}
                  >
                    {#snippet leading()}<Fa
                        icon={faWindowMaximize}
                        class="size-3 rotate-180"
                      />{/snippet}
                    {m.workspace_shell_showInBottomBar_tooltip()}
                  </Menu.Item>
                {/snippet}
              </DropdownMenu>
            </div>
            <div class="flex shrink-0 items-center" data-script-actions>
              {#if live}
                {@const stopLabel = m.terminal_quakeOverlay_stop_label()}
                {@const restartLabel = m.workspace_devScripts_restart_ariaLabel({
                  name: script.name,
                })}
                <Button
                  variant="ghost"
                  size="icon-compact"
                  iconOnly
                  class="size-7 shrink-0 text-danger hover:text-danger active:bg-accent/80"
                  disabled={operation?.pending ?? false}
                  aria-busy={operation?.pending && operation.action === 'stop' ? true : undefined}
                  aria-label={stopLabel}
                  tooltip={stopLabel}
                  tooltipSide="left"
                  onclick={(event) => runScript(script.id, 'stop', event)}
                  data-script-action="stop"
                >
                  {#if operation?.pending && operation.action === 'stop'}
                    <IntentMarkLoader size={12} />
                  {:else}
                    <Fa icon={faStop} class="size-3" />
                  {/if}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-compact"
                  iconOnly
                  class="size-7 shrink-0 active:bg-accent/80"
                  disabled={operation?.pending ?? false}
                  aria-busy={operation?.pending && operation.action === 'restart'
                    ? true
                    : undefined}
                  aria-label={restartLabel}
                  tooltip={restartLabel}
                  tooltipSide="left"
                  onclick={(event) => runScript(script.id, 'restart', event)}
                  data-script-action="restart"
                >
                  {#if operation?.pending && operation.action === 'restart'}
                    <IntentMarkLoader size={12} />
                  {:else}
                    <Fa icon={faRotateRight} class="size-3" />
                  {/if}
                </Button>
              {:else}
                {@const startLabel = m.workspace_devScripts_start_ariaLabel({ name: script.name })}
                <Button
                  variant="ghost"
                  size="icon-compact"
                  iconOnly
                  class="size-7 shrink-0 active:bg-accent/80"
                  disabled={operation?.pending ?? false}
                  aria-busy={operation?.pending || undefined}
                  aria-label={startLabel}
                  tooltip={startLabel}
                  tooltipSide="left"
                  onclick={(event) => runScript(script.id, 'start', event)}
                  data-script-action="start"
                >
                  {#if operation?.pending}
                    <IntentMarkLoader size={12} />
                  {:else}
                    <Fa icon={faPlay} class="size-3" />
                  {/if}
                </Button>
              {/if}
            </div>
          </div>
        {:else}
          <p class="px-2 py-1.5 text-sm text-muted-foreground">
            {m.terminal_sidebar_noScriptsAddManually_label()}
          </p>
        {/each}
      </div>
    {/if}
  </section>
</div>
