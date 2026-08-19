<script lang="ts">
  import { faPlay, faTerminal } from '@fortawesome/free-solid-svg-icons';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import { Button } from '$lib/components/ui/button';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils';
  import {
    selectActiveTerminalIdForWorkspace,
    selectTerminalsForWorkspace,
  } from '$store/renderer/slices/terminals/terminals-selectors';
  import { openTerminalOverlay } from '$store/renderer/slices/terminals/terminals-slice';
  import { selectWorkspaceScriptEntries } from '$store/renderer/slices/scripts/scripts-selectors';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspaceId: string;
    onExpand?: () => void;
    expanded?: boolean;
  }

  let { workspaceId, onExpand, expanded = false }: Props = $props();

  const workspaceIdStore = writable('');
  $effect(() => workspaceIdStore.set(workspaceId));
  const activeTerminalId$ = selectActiveTerminalIdForWorkspace(workspaceIdStore);
  const terminals$ = selectTerminalsForWorkspace(workspaceIdStore);
  const scripts$ = selectWorkspaceScriptEntries(workspaceIdStore);

  function openTerminal(terminalId?: string) {
    appStore.dispatch(openTerminalOverlay(workspaceId, terminalId));
  }

  function openShell() {
    if (onExpand) {
      onExpand();
      return;
    }
    openTerminal($terminals$[0]?.id);
  }

  function openScripts() {
    appStore.dispatch(openTerminalOverlay(workspaceId));
  }

  const devScriptsLabel = $derived(
    $scripts$.length === 1
      ? m.workspace_terminalDock_devScripts_one()
      : m.workspace_terminalDock_devScripts_many({ count: formatInteger($scripts$.length) }),
  );
</script>

<div
  class="relative flex h-11 min-w-0 w-full items-center cursor-pointer overflow-hidden rounded-lg border border-border bg-sidebar px-3 text-foreground transition-colors"
  data-workspace-terminal-dock
  data-sidebar-card-surface
>
  <Button
    variant="plain"
    class="absolute inset-0 z-0 h-auto cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
    onclick={openShell}
    aria-label={m.workspace_terminalDock_shell_label()}
    aria-expanded={onExpand ? expanded : undefined}
  ></Button>
  <div
    class="pointer-events-none relative z-10 flex h-7 min-w-0 flex-1 items-center gap-1"
    data-sidebar-launcher-row
  >
    <span class="cursor-pointer truncate text-sm font-semibold flex-1" data-sidebar-launcher-label
      >{m.workspace_terminalDock_shell_label()}</span
    >
    {#each $terminals$.slice(0, 1) as terminal (terminal.id)}
      {@const terminalName =
        terminal.customName || terminal.name || m.workspace_terminalDock_terminal_fallback()}
      <Tooltip content={terminalName} side="top" delayDuration={300}>
        <Button
          variant="plain"
          size="icon-xs"
          iconOnly
          class={cn(
            'pointer-events-auto relative z-20 flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 w-5! text-muted-foreground transition-colors hover:text-foreground',
            terminal.id === $activeTerminalId$ && 'text-foreground',
          )}
          onclick={() => openTerminal(terminal.id)}
          aria-label={m.workspace_terminalDock_openTerminal_ariaLabel({ name: terminalName })}
          aria-pressed={terminal.id === $activeTerminalId$}
          data-terminal-id={terminal.id}
        >
          <Fa icon={faTerminal} size="xs" />
        </Button>
      </Tooltip>
    {/each}

    {#if $scripts$.length > 0}
      <Tooltip content={devScriptsLabel} side="top" delayDuration={300}>
        <Button
          variant="plain"
          size="icon-xs"
          iconOnly
          class="pointer-events-auto relative z-20 flex w-5! cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-xs tabular-nums text-muted-foreground transition-colors hover:text-foreground"
          onclick={openScripts}
          aria-label={devScriptsLabel}
          data-dev-script-count
        >
          <Fa icon={faPlay} size="xs" />
        </Button>
      </Tooltip>
    {/if}
  </div>
</div>
