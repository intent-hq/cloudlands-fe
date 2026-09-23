<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { InputMessage } from '$lib/components/ui/input-message';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { FormActions } from '$lib/components/patterns/form';
  import { ListRow } from '$lib/components/patterns/collection';
  import type { InterruptedAgent, ResolveInterruptedResult } from '$lib/client/app-client';
  import AgentAvatarStack from '$features/agent/components/agent-avatar/AgentAvatarStack.svelte';
  import { m } from '$shared/paraglide/messages.js';

  type Resolution = void | ResolveInterruptedResult;
  interface Props {
    open?: boolean;
    /** Compatibility with older catalog callers; static previews render in place. */
    portalTarget?: string | HTMLElement;
    inline?: boolean;
    agents?: InterruptedAgent[];
    onResumeSelected?: (
      resumeIds: string[],
      abandonIds: string[],
    ) => Resolution | Promise<Resolution>;
    onAbandonAll?: (abandonIds: string[]) => Resolution | Promise<Resolution>;
    onClose?: () => void;
  }
  let {
    open = $bindable(false),
    inline = false,
    agents = [],
    onResumeSelected,
    onAbandonAll,
    onClose,
  }: Props = $props();
  let checked = $state<string[]>([]);
  let resolved = $state<string[]>([]);
  let busy = $state(false);
  let error = $state('');
  let confirmingAbandon = $state(false);
  let knownIds = new Set<string>();
  $effect(() => {
    if (open)
      untrack(() => {
        resolved = [];
        checked = agents.map((agent) => agent.agentId);
        knownIds = new Set(checked);
        error = '';
        confirmingAbandon = false;
      });
  });
  const remaining = $derived(agents.filter((agent) => !resolved.includes(agent.agentId)));
  const selected = $derived(remaining.filter((agent) => checked.includes(agent.agentId)));
  const groups = $derived.by(() => {
    const byWorkspace = new Map<string, { id: string; name: string; agents: InterruptedAgent[] }>();
    for (const agent of remaining) {
      let group = byWorkspace.get(agent.workspaceId);
      if (!group) {
        group = {
          id: agent.workspaceId,
          name: agent.workspaceName || agent.workspaceId,
          agents: [],
        };
        byWorkspace.set(agent.workspaceId, group);
      }
      group.agents.push(agent);
    }
    return [...byWorkspace.values()];
  });

  $effect(() => {
    const previous = untrack(() => checked);
    checked = agents
      .filter((agent) => !knownIds.has(agent.agentId) || previous.includes(agent.agentId))
      .map((agent) => agent.agentId);
    knownIds = new Set(agents.map((agent) => agent.agentId));
  });

  function close() {
    if (busy) return;
    open = false;
    onClose?.();
  }

  async function resolve(abandon: boolean) {
    if (busy || (!abandon && selected.length === 0)) return;
    const ids = (abandon ? remaining : selected).map((agent) => agent.agentId);
    busy = true;
    error = '';
    try {
      const result = abandon ? await onAbandonAll?.(ids) : await onResumeSelected?.(ids, []);
      const completed = result ? [...result.resumed, ...result.abandoned] : ids;
      resolved = [...resolved, ...completed];
      checked = checked.filter((id) => !completed.includes(id));
      confirmingAbandon = false;
      if (result?.failed.length) {
        error =
          result.failed.length === 1
            ? m.layout_appShell_resolveFailedCount_one({ count: 1 })
            : m.layout_appShell_resolveFailedCount_many({ count: result.failed.length });
      }
      if (agents.every((agent) => resolved.includes(agent.agentId))) {
        busy = false;
        close();
      }
    } catch {
      error = abandon
        ? m.layout_appShell_abandonInterruptedFailed_error()
        : m.layout_appShell_resolveInterruptedFailed_error();
    } finally {
      busy = false;
    }
  }
</script>

{#if open && remaining.length > 0}
  <ContentDialog
    bind:open
    static={inline}
    role="alertdialog"
    title={m.modals_interruptedAgents_title()}
    description={confirmingAbandon
      ? m.modals_interruptedAgents_abandon_description()
      : m.modals_interruptedAgents_description()}
    titleId="interrupted-agents-dialog-title"
    descriptionId="interrupted-agents-dialog-description"
    closeLabel={m.modals_interruptedAgents_close_ariaLabel()}
    {busy}
    dismissOnInteractOutside={false}
    onClose={close}
    onkeydowncapture={(event) => {
      if (
        event.key === 'Enter' &&
        (event.metaKey || event.ctrlKey) &&
        !confirmingAbandon &&
        !event.isComposing
      ) {
        event.preventDefault();
        event.stopPropagation();
        void resolve(false);
      }
    }}
  >
    <fieldset disabled={busy} class="min-w-0" aria-busy={busy}>
      <div class="grid">
        {#each groups as group (group.id)}
          <ListRow class="min-h-8 gap-2 px-0 py-1">
            {#snippet leading()}
              {#if !confirmingAbandon}
                <Checkbox
                  checked={group.agents.every((agent) => checked.includes(agent.agentId))}
                  indeterminate={group.agents.some((agent) => checked.includes(agent.agentId)) &&
                    !group.agents.every((agent) => checked.includes(agent.agentId))}
                  disabled={busy}
                  ariaLabel={group.name}
                  onCheckedChange={(value) => {
                    const ids = group.agents.map((agent) => agent.agentId);
                    checked = value
                      ? [...new Set([...checked, ...ids])]
                      : checked.filter((id) => !ids.includes(id));
                  }}
                />
              {/if}
            {/snippet}
            {#snippet title()}{group.name}{/snippet}
            {#snippet trailing()}
              <AgentAvatarStack
                items={group.agents.map((agent) => ({
                  key: agent.agentId,
                  agentId: agent.agentId,
                }))}
                maxVisible={4}
                align="end"
              />
            {/snippet}
          </ListRow>
        {/each}
      </div>
    </fieldset>
    {#if error}<InputMessage tone="error">{error}</InputMessage>{/if}
    {#snippet footer()}
      <FormActions class="gap-1 [&>[data-slot=form-actions-end]]:gap-1">
        {#snippet destructive()}
          {#if !confirmingAbandon}<Button
              variant="ghost"
              class="px-2 text-danger"
              disabled={busy}
              onclick={() => (confirmingAbandon = true)}
              >{m.modals_interruptedAgents_abandonAll_label()}</Button
            >{/if}
        {/snippet}
        {#snippet secondary()}
          {#if confirmingAbandon}
            <Button
              variant="ghost-light"
              class="px-2"
              disabled={busy}
              onclick={() => (confirmingAbandon = false)}
            >
              {m.modals_bulkActionConfirm_cancel_label()}
            </Button>
          {/if}
        {/snippet}
        {#snippet primary()}
          <Button
            variant={confirmingAbandon ? 'destructive' : 'primary'}
            loading={busy}
            disabled={busy || (!confirmingAbandon && selected.length === 0)}
            onclick={() => resolve(confirmingAbandon)}
          >
            {confirmingAbandon
              ? m.modals_interruptedAgents_abandonAll_label()
              : m.modals_interruptedAgents_resumeSelected_label()}
          </Button>
        {/snippet}
      </FormActions>
    {/snippet}
  </ContentDialog>
{/if}
