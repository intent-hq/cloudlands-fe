<script lang="ts">
  /**
   * Modal for resuming or abandoning interrupted agents after intentd restart.
   * Grouped by workspace with checkboxes (all checked by default).
   */
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faExclamationTriangle, faXmark } from '@fortawesome/free-solid-svg-icons';
  import Portal from '$lib/components/ui/Portal.svelte';
  import type { InterruptedAgent } from '$lib/client/app-client';

  interface Props {
    open?: boolean;
    agents?: InterruptedAgent[];
    onResumeSelected?: (resumeIds: string[], abandonIds: string[]) => void;
    onAbandonAll?: (abandonIds: string[]) => void;
    onClose?: () => void;
  }

  let {
    open = $bindable(false),
    agents = [],
    onResumeSelected,
    onAbandonAll,
    onClose,
  }: Props = $props();

  const dialogTitleId = 'interrupted-agents-dialog-title';
  const dialogDescriptionId = 'interrupted-agents-dialog-description';

  // Group agents by workspace
  const agentsByWorkspace = $derived(() => {
    const groups = new Map<string, InterruptedAgent[]>();
    for (const agent of agents) {
      const ws = agent.workspaceId;
      if (!groups.has(ws)) {
        groups.set(ws, []);
      }
      groups.get(ws)!.push(agent);
    }
    return Array.from(groups.entries()).map(([workspaceId, wsAgents]) => ({
      workspaceId,
      workspaceName: wsAgents[0]?.workspaceName ?? workspaceId,
      agents: wsAgents,
    }));
  });

  // All agents checked by default
  let checkedAgents = $state<Set<string>>(new Set(agents.map((a) => a.agentId)));

  // Reset checked state when agents change
  $effect(() => {
    checkedAgents = new Set(agents.map((a) => a.agentId));
  });

  function close() {
    open = false;
    onClose?.();
  }

  function handleResumeSelected() {
    const allIds = agents.map((a) => a.agentId);
    const resumeIds = allIds.filter((id) => checkedAgents.has(id));
    const abandonIds = allIds.filter((id) => !checkedAgents.has(id));
    onResumeSelected?.(resumeIds, abandonIds);
    open = false;
  }

  function handleAbandonAll() {
    const allIds = agents.map((a) => a.agentId);
    onAbandonAll?.(allIds);
    open = false;
  }

  function toggleAgent(agentId: string) {
    if (checkedAgents.has(agentId)) {
      checkedAgents.delete(agentId);
    } else {
      checkedAgents.add(agentId);
    }
    checkedAgents = new Set(checkedAgents); // trigger reactivity
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
</script>

{#if open && agents.length > 0}
  <Portal target="body" zIndex={100}>
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      role="presentation"
      onkeydown={handleKeydown}
      onclick={close}
    >
      <div
        class="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border/80 bg-background shadow-xl shadow-black/20 max-h-[85vh]"
        onclick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
        tabindex="-1"
        onkeydown={handleKeydown}
      >
        <div class="flex items-start justify-between gap-4 px-6 pt-6">
          <div class="flex items-start gap-4">
            <div
              class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-600 ring-1 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-400"
            >
              <Fa icon={faExclamationTriangle} size="lg" />
            </div>
            <div>
              <h2 id={dialogTitleId} class="text-lg font-semibold leading-6">
                Agents were interrupted
              </h2>
              <p class="mt-1 text-sm text-subtle">
                Intent restarted while these agents were working. Resume selected or abandon all.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            class="-mr-1 mt-0.5 text-subtle hover:text-foreground"
            aria-label="Close interrupted agents dialog"
            onclick={close}
          >
            <Fa icon={faXmark} />
          </Button>
        </div>

        <div id={dialogDescriptionId} class="flex-1 overflow-auto px-6 py-5 space-y-4">
          {#each agentsByWorkspace() as { workspaceId: _workspaceId, workspaceName, agents: wsAgents }}
            <div class="space-y-2">
              <h3 class="text-sm font-medium text-foreground">{workspaceName}</h3>
              <div class="space-y-1.5 pl-2">
                {#each wsAgents as agent (agent.agentId)}
                  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                  <div
                    class="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/40 cursor-pointer"
                    onclick={() => toggleAgent(agent.agentId)}
                  >
                    <input
                      type="checkbox"
                      checked={checkedAgents.has(agent.agentId)}
                      class="size-4 rounded border-border"
                      onchange={() => toggleAgent(agent.agentId)}
                    />
                    <div class="flex-1 min-w-0">
                      <p class="text-sm text-foreground truncate">{agent.agentName}</p>
                      <p class="text-xs text-subtle">
                        {agent.prevStatus} • interrupted {new Date(agent.interruptedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>

        <div
          class="flex flex-col-reverse gap-2 border-t border-border/70 bg-muted/20 px-6 py-4 sm:flex-row sm:justify-end"
        >
          <Button variant="outline" onclick={handleAbandonAll}>Abandon all</Button>
          <Button variant="default" class="sm:min-w-[11rem]" onclick={handleResumeSelected}>
            Resume selected
          </Button>
        </div>
      </div>
    </div>
  </Portal>
{/if}
