<script lang="ts">
  import { writable } from 'svelte/store';
  import { isLiveScriptStatus } from '$features/scripts/utils/script-status';
  import { Button } from '$lib/components/ui/button';
  import { selectWorkspaceScriptEntries } from '$store/renderer/slices/scripts/scripts-selectors';
  import {
    selectActiveTerminalIdForWorkspace,
    selectTerminalsForWorkspace,
  } from '$store/renderer/slices/terminals/terminals-selectors';
  import {
    openTerminalOverlay,
    selectScript,
  } from '$store/renderer/slices/terminals/terminals-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  let { workspaceId }: { workspaceId: string } = $props();
  const workspaceIdStore = writable(workspaceId);
  $effect(() => workspaceIdStore.set(workspaceId));
  const terminals$ = selectTerminalsForWorkspace(workspaceIdStore);
  const activeTerminalId$ = selectActiveTerminalIdForWorkspace(workspaceIdStore);
  const scripts$ = selectWorkspaceScriptEntries(workspaceIdStore);
  const orderedScripts = $derived(
    $scripts$.toSorted(
      (left, right) =>
        Number(isLiveScriptStatus(right.runtime.status)) -
          Number(isLiveScriptStatus(left.runtime.status)) || left.name.localeCompare(right.name),
    ),
  );

  function openTerminal(terminalId: string) {
    appStore.dispatch(openTerminalOverlay(workspaceId, terminalId));
  }

  function openScript(scriptId: string) {
    appStore.dispatch(selectScript(workspaceId, scriptId));
    appStore.dispatch(openTerminalOverlay(workspaceId));
  }
</script>

<div class="flex min-w-0 flex-col gap-5 px-4" data-workspace-shell-list>
  <section>
    <h6 class="mb-1 px-2 text-left text-xs font-semibold text-muted-foreground">
      {m.terminal_sidebar_terminals_title()}
    </h6>
    <div class="flex flex-col gap-1">
      {#each $terminals$ as terminal (terminal.id)}
        {@const active = terminal.id === $activeTerminalId$}
        <Button
          variant="plain"
          class="flex h-auto w-full cursor-pointer items-center justify-start gap-2 rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:bg-muted"
          onclick={() => openTerminal(terminal.id)}
          data-sidebar-shell-terminal={terminal.id}
          data-active={active || undefined}
        >
          <span
            class="size-1.5 shrink-0 rounded-full {active
              ? 'bg-success'
              : 'bg-muted-foreground/40'}"
            aria-hidden="true"
          ></span>
          <span class="min-w-0 truncate text-sm font-medium text-foreground">
            {terminal.customName || terminal.name || m.workspace_terminalDock_terminal_fallback()}
          </span>
        </Button>
      {:else}
        <p class="px-2 py-2 text-sm text-muted-foreground">
          {m.terminal_sidebar_noTerminals_label()}
        </p>
      {/each}
    </div>
  </section>
  <section>
    <h6 class="mb-1 px-2 text-left text-xs font-semibold text-muted-foreground">
      {m.workspace_devScripts_title()}
    </h6>
    <div class="flex flex-col gap-1">
      {#each orderedScripts as script (script.id)}
        {@const live = isLiveScriptStatus(script.runtime.status)}
        <div
          class="group/script flex min-w-0 items-center gap-2 rounded-md px-2 py-2 hover:bg-muted focus-within:bg-muted"
          data-sidebar-shell-script={script.id}
          data-live={live || undefined}
        >
          <Button
            variant="plain"
            class="flex h-auto min-w-0 flex-1 cursor-pointer items-start justify-start gap-2 p-0! text-left"
            onclick={() => openScript(script.id)}
          >
            <span
              class="mt-1.5 size-1.5 shrink-0 rounded-full {live
                ? 'bg-success'
                : 'bg-muted-foreground/40'}"
              aria-hidden="true"
            ></span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-foreground">{script.name}</span>
              <span class="block truncate text-xs text-muted-foreground" title={script.command}
                >{script.command}</span
              >
            </span>
          </Button>
        </div>
      {:else}
        <p class="px-2 py-2 text-sm text-muted-foreground">
          {m.terminal_sidebar_noScriptsAddManually_label()}
        </p>
      {/each}
    </div>
  </section>
</div>
