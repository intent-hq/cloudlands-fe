<script lang="ts">
  /**
   * Terminal Tab Type Component
   *
   * Renders a terminal session.
   */

  import Fa from 'svelte-fa';
  import { faChevronDown } from '$lib/icons/phosphor-icons';
  import { Button } from '$lib/components/ui/button';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import Terminal from '$lib/components/terminal/Terminal.svelte';
  import ScriptOutputViewer from '$lib/components/terminal/ScriptOutputViewer.svelte';
  import { closeTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import {
    openTerminalOverlay,
    selectScript,
  } from '$store/renderer/slices/terminals/terminals-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import type { TabTypeComponentProps } from './registry';

  let { tab, workspaceId, layoutId, isActive }: TabTypeComponentProps = $props();

  const terminalId = $derived(tab.terminalId);
  const scriptId = $derived(tab.scriptId);
  const headerContext = getPanelHeaderContext();

  function moveToBottomBar() {
    if (scriptId) appStore.dispatch(selectScript(workspaceId, scriptId));
    appStore.dispatch(openTerminalOverlay(workspaceId, terminalId));
    appStore.dispatch(closeTab(layoutId ?? workspaceId, tab.id));
  }

  $effect(() => {
    if (!headerContext || !isActive) return;
    return headerContext.registerActions({ primary: surfaceAction });
  });
</script>

{#snippet surfaceAction()}
  <Button
    variant="ghost-light"
    size="icon-sm"
    onclick={moveToBottomBar}
    tooltip={m.workspace_shell_showInBottomBar_tooltip()}
    aria-label={m.workspace_shell_showInBottomBar_tooltip()}
    data-move-to-bottom-bar
  >
    <Fa icon={faChevronDown} size="xs" />
  </Button>
{/snippet}

{#if scriptId && isActive}
  {#key scriptId}
    <ScriptOutputViewer
      {scriptId}
      {workspaceId}
      class="h-full"
      onDelete={() => appStore.dispatch(closeTab(layoutId ?? workspaceId, tab.id))}
    />
  {/key}
{:else if terminalId && isActive}
  {#key terminalId}
    <Terminal {terminalId} {workspaceId} class="h-full" />
  {/key}
{/if}
