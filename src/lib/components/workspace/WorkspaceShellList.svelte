<script lang="ts">
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import type { ScriptStatus } from '$features/scripts/types';
  import { getPanelLayoutManager } from '$features/layout/panel-layout-adapter';
  import { isLiveScriptStatus } from '$features/scripts/utils/script-status';
  import { Button } from '$lib/components/ui/button';
  import {
    faExclamationTriangle,
    faChevronDown,
    faPlay,
    faRotateRight,
    faSpinner,
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
    selectTerminalPlacement,
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

  function lastPlacement(id: string) {
    return selectTerminalPlacement.select(appStore.state, workspaceId, id);
  }

  // Default click: reopen where the terminal/script was last shown.
  function openTerminal(terminalId: string, title: string) {
    if (lastPlacement(terminalId) === 'panel') openTerminalInPanel(terminalId, title);
    else showTerminalInOverlay(terminalId);
  }

  function openScript(scriptId: string, title: string) {
    if (lastPlacement(scriptId) === 'panel') openScriptInPanel(scriptId, title);
    else showScriptInOverlay(scriptId);
  }

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

  function statusLabel(status: ScriptStatus) {
    switch (status) {
      case 'running':
        return m.workspace_devScripts_running_label();
      case 'restarting':
        return m.workspace_devScripts_restarting_label();
      case 'exited':
        return m.workspace_devScripts_exited_label();
      default:
        return m.workspace_devScripts_idle_label();
    }
  }
</script>

<div class="flex min-w-0 flex-col gap-4 px-4" data-workspace-shell-list>
  <section>
    <h6 class="mb-1 text-left text-xs font-semibold text-muted-foreground">
      {m.terminal_sidebar_terminals_title()}
    </h6>
    <div class="flex flex-col gap-0">
      {#each $terminals$ as terminal (terminal.id)}
        {@const active = terminal.id === $activeTerminalId$}
        {@const terminalName =
          terminal.customName || terminal.name || m.workspace_terminalDock_terminal_fallback()}
        <div
          class="group/terminal flex h-8 min-w-0 items-center gap-2 rounded-md hover:bg-muted focus-within:bg-muted"
          data-sidebar-shell-terminal={terminal.id}
          data-active={active || undefined}
        >
          <Button
            variant="plain"
            class="flex h-full min-w-0 flex-1 cursor-pointer items-center justify-start gap-2 p-0! text-left"
            onclick={() => openTerminal(terminal.id, terminalName)}
          >
            <span
              class="size-1.5 shrink-0 rounded-full {active
                ? 'bg-success'
                : 'bg-muted-foreground/40'}"
              aria-hidden="true"
            ></span>
            <span class="min-w-0 truncate text-sm font-medium text-foreground">{terminalName}</span>
          </Button>
          <div class="flex shrink-0 items-center" data-surface-actions>
            <Button
              variant="ghost-light"
              size="icon-xs"
              iconOnly
              class="size-7"
              tooltip={m.workspace_shell_showInPanel_tooltip()}
              tooltipSide="left"
              onclick={(event) => {
                event.stopPropagation();
                openTerminalInPanel(terminal.id, terminalName);
              }}
            >
              <Fa icon={faTableColumns} class="size-3" />
            </Button>
            <Button
              variant="ghost-light"
              size="icon-xs"
              iconOnly
              class="size-7"
              tooltip={m.workspace_shell_showInBottomBar_tooltip()}
              tooltipSide="left"
              onclick={(event) => {
                event.stopPropagation();
                showTerminalInOverlay(terminal.id);
              }}
            >
              <Fa icon={faChevronDown} class="size-3" />
            </Button>
          </div>
        </div>
      {:else}
        <p class="px-0 py-1.5 text-sm text-muted-foreground">
          {m.terminal_sidebar_noTerminals_label()}
        </p>
      {/each}
    </div>
  </section>
  <section>
    <h6 class="mb-1 text-left text-xs font-semibold text-muted-foreground">
      {m.workspace_devScripts_title()}
    </h6>
    <div class="flex flex-col gap-0">
      {#each orderedScripts as script (script.id)}
        {@const live = isLiveScriptStatus(script.runtime.status)}
        {@const operation = $operations$[script.id]}
        {@const errorLabel = operation?.error
          ? m.workspace_devScripts_actionFailed_error({
              name: script.name,
              error: operation.error,
            })
          : undefined}
        <div
          class="group/script flex h-8 min-w-0 items-center gap-2 rounded-md px-0 py-0 hover:bg-muted focus-within:bg-muted"
          data-sidebar-shell-script={script.id}
          data-live={live || undefined}
        >
          <Button
            variant="plain"
            class="flex h-full min-w-0 flex-1 cursor-pointer items-center justify-start gap-2 p-0! text-left"
            onclick={() => openScript(script.id, script.name)}
          >
            <span
              class="size-1.5 shrink-0 rounded-full {live
                ? 'bg-success'
                : 'bg-muted-foreground/40'}"
              aria-hidden="true"
              data-script-status-indicator
            ></span>
            <span
              class="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
              title={script.name}
            >
              {script.name}
            </span>
            <span
              class="shrink-0 text-xs leading-none text-muted-foreground"
              data-script-status={script.runtime.status}>{statusLabel(script.runtime.status)}</span
            >
          </Button>
          <span
            class="flex size-4 shrink-0 items-center justify-center text-danger"
            role={errorLabel ? 'alert' : undefined}
            aria-label={errorLabel}
            title={errorLabel}
            data-script-error-slot
          >
            {#if errorLabel}
              <Fa icon={faExclamationTriangle} class="size-3" />
            {/if}
          </span>
          <div class="flex shrink-0 items-center" data-surface-actions>
            <Button
              variant="ghost-light"
              size="icon-xs"
              iconOnly
              class="size-7"
              tooltip={m.workspace_shell_showInPanel_tooltip()}
              tooltipSide="left"
              onclick={(event) => {
                event.stopPropagation();
                openScriptInPanel(script.id, script.name);
              }}
            >
              <Fa icon={faTableColumns} class="size-3" />
            </Button>
            <Button
              variant="ghost-light"
              size="icon-xs"
              iconOnly
              class="size-7"
              tooltip={m.workspace_shell_showInBottomBar_tooltip()}
              tooltipSide="left"
              onclick={(event) => {
                event.stopPropagation();
                showScriptInOverlay(script.id);
              }}
            >
              <Fa icon={faChevronDown} class="size-3" />
            </Button>
          </div>
          <div
            class="flex shrink-0 items-center rounded-md bg-secondary/80 px-1"
            data-script-actions
          >
            {#if live}
              {@const stopLabel = m.terminal_quakeOverlay_stop_label()}
              {@const restartLabel = m.workspace_devScripts_restart_ariaLabel({
                name: script.name,
              })}
              <Button
                variant="ghost-light"
                size="icon-xs"
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
                  <Fa icon={faSpinner} class="size-3 animate-spin motion-reduce:animate-none" />
                {:else}
                  <Fa icon={faStop} class="size-3" />
                {/if}
              </Button>
              <Button
                variant="ghost-light"
                size="icon-xs"
                iconOnly
                class="size-7 shrink-0 active:bg-accent/80"
                disabled={operation?.pending ?? false}
                aria-busy={operation?.pending && operation.action === 'restart' ? true : undefined}
                aria-label={restartLabel}
                tooltip={restartLabel}
                tooltipSide="left"
                onclick={(event) => runScript(script.id, 'restart', event)}
                data-script-action="restart"
              >
                {#if operation?.pending && operation.action === 'restart'}
                  <Fa icon={faSpinner} class="size-3 animate-spin motion-reduce:animate-none" />
                {:else}
                  <Fa icon={faRotateRight} class="size-3" />
                {/if}
              </Button>
            {:else}
              {@const startLabel = m.workspace_devScripts_start_ariaLabel({ name: script.name })}
              <Button
                variant="ghost-light"
                size="icon-xs"
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
                  <Fa icon={faSpinner} class="size-3 animate-spin motion-reduce:animate-none" />
                {:else}
                  <Fa icon={faPlay} class="size-3" />
                {/if}
              </Button>
            {/if}
          </div>
        </div>
      {:else}
        <p class="px-0 py-1.5 text-sm text-muted-foreground">
          {m.terminal_sidebar_noScriptsAddManually_label()}
        </p>
      {/each}
    </div>
  </section>
</div>
