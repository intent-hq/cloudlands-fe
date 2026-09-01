<script lang="ts">
  /**
   * Modal for resuming or abandoning interrupted agents after intentd restart.
   * Grouped by workspace with checkboxes (all checked by default).
   */
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import Fa from 'svelte-fa';
  import { faExclamationTriangle, faXmark } from '@fortawesome/free-solid-svg-icons';
  import Portal from '$lib/components/ui/Portal.svelte';
  import type { InterruptedAgent } from '$lib/client/app-client';
  import { formatDateTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';

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

  let dialogEl = $state<HTMLDivElement | null>(null);

  // Move focus into the dialog on open (ARIA alertdialog pattern) so Escape
  // reaches the keydown handler immediately — without this, focus stays on
  // the previously focused page element outside the portal. `agents` is read
  // untracked: the dialog mounting (bind:this assigning dialogEl) already
  // re-runs the effect, and tracking `agents` would re-steal focus from a
  // checkbox/button when a cross-window prune replaces the array mid-open.
  $effect(() => {
    if (open && dialogEl && untrack(() => agents.length > 0)) {
      dialogEl.focus();
    }
  });

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
  // svelte-ignore state_referenced_locally - intentional initial capture; the reconcile $effect below syncs later changes
  let checkedAgents = $state<Set<string>>(new Set(agents.map((a) => a.agentId)));

  // Reconcile checked state when agents change: survivors of a cross-window
  // prune keep their checkbox state; agents not previously listed default to
  // checked.
  // svelte-ignore state_referenced_locally - intentional initial capture; updated inside the reconcile $effect
  let knownAgentIds = new Set(agents.map((a) => a.agentId));
  $effect(() => {
    const checked = untrack(() => checkedAgents);
    const next = new Set<string>();
    for (const agent of agents) {
      if (!knownAgentIds.has(agent.agentId) || checked.has(agent.agentId)) {
        next.add(agent.agentId);
      }
    }
    knownAgentIds = new Set(agents.map((a) => a.agentId));
    checkedAgents = next;
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
        bind:this={dialogEl}
        class="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl shadow-black/20 max-h-[85vh] outline-none"
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
                {m.modals_interruptedAgents_title()}
              </h2>
              <p class="mt-1 text-sm text-subtle">
                {m.modals_interruptedAgents_description()}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            class="-mr-1 mt-0.5 text-subtle hover:text-foreground"
            aria-label={m.modals_interruptedAgents_close_ariaLabel()}
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
                  <label
                    for={`interrupted-agent-${agent.agentId}`}
                    class="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/40 cursor-pointer"
                  >
                    <Checkbox
                      id={`interrupted-agent-${agent.agentId}`}
                      checked={checkedAgents.has(agent.agentId)}
                      onCheckedChange={() => toggleAgent(agent.agentId)}
                      ariaLabel={agent.agentName}
                    />
                    <div class="flex-1 min-w-0">
                      <p class="text-sm text-foreground truncate">{agent.agentName}</p>
                      <p class="text-xs text-subtle">
                        {m.modals_interruptedAgents_statusLine_label({
                          status: agent.prevStatus,
                          timestamp: formatDateTime(agent.interruptedAt),
                        })}
                      </p>
                    </div>
                  </label>
                {/each}
              </div>
            </div>
          {/each}
        </div>

        <div
          class="flex flex-col-reverse gap-2 border-t border-border bg-muted/20 px-6 py-4 sm:flex-row sm:justify-end"
        >
          <Button variant="outline" onclick={handleAbandonAll}
            >{m.modals_interruptedAgents_abandonAll_label()}</Button
          >
          <Button variant="default" class="sm:min-w-[11rem]" onclick={handleResumeSelected}>
            {m.modals_interruptedAgents_resumeSelected_label()}
          </Button>
        </div>
      </div>
    </div>
  </Portal>
{/if}
