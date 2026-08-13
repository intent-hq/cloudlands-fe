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
  }

  let { workspaceId }: Props = $props();

  const workspaceIdStore = writable('');
  $effect(() => workspaceIdStore.set(workspaceId));
  const activeTerminalId$ = selectActiveTerminalIdForWorkspace(workspaceIdStore);
  const terminals$ = selectTerminalsForWorkspace(workspaceIdStore);
  const scripts$ = selectWorkspaceScriptEntries(workspaceIdStore);

  function openTerminal(terminalId?: string) {
    appStore.dispatch(openTerminalOverlay(workspaceId, terminalId));
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
  class={cn(
    'flex min-w-0 w-full items-center gap-1 rounded-lg border border-border bg-card px-4 py-2 text-left',
  )}
  data-workspace-terminal-dock
>
  <Button
    variant="plain"
    class="min-w-0 flex-1 justify-start truncate text-sm font-medium"
    onclick={() => openTerminal($terminals$[0]?.id)}
  >
    {m.workspace_terminalDock_shell_label()}
  </Button>
  {#each $terminals$.slice(0, 1) as terminal (terminal.id)}
    {@const terminalName = terminal.customName || terminal.name || 'Terminal'}
    <Tooltip content={terminalName} side="top" delayDuration={300}>
      <Button
        variant="plain"
        size="icon-xs"
        iconOnly
        class={cn(
          'flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 w-5! text-muted-foreground transition-colors hover:text-foreground',
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
        class="flex gap-1.5 cursor-pointer items-center justify-center border-0 bg-transparent p-0 w-5! text-xs tabular-nums text-muted-foreground transition-colors hover:text-foreground"
        onclick={openScripts}
        aria-label={devScriptsLabel}
        data-dev-script-count
      >
        <Fa icon={faPlay} size="xs" />
      </Button>
    </Tooltip>
  {/if}
</div>
