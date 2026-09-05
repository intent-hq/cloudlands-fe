<script lang="ts">
  /**
   * Modal for resuming or abandoning interrupted agents after intentd restart.
   * Grouped by workspace with checkboxes (all checked by default).
   */
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { CheckboxGroup } from '$lib/components/ui/checkbox-group';
  import { ShortcutChip } from '$lib/components/ui/kbd';
  import { ListRow, ListView, SectionedList } from '$lib/components/patterns/collection';
  import { TakeoverScreen } from '$lib/components/patterns/screen';
  import { crispOut, springIn } from '$lib/motion';
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

  let dialogEl = $state<HTMLElement | null>(null);

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
  const allSelected = $derived(agents.length > 0 && checkedAgents.size === agents.length);
  const someSelected = $derived(checkedAgents.size > 0 && !allSelected);
  const navigatorPlatform =
    typeof navigator === 'undefined'
      ? ''
      : ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
          ?.platform ?? navigator.platform);
  const isMac = /mac/i.test(navigatorPlatform);

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

  function setSelection(agentIds: string[]) {
    checkedAgents = new Set(agentIds);
  }

  function toggleAll(checked: boolean) {
    checkedAgents = checked ? new Set(agents.map((agent) => agent.agentId)) : new Set();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      handleResumeSelected();
    }
  }
</script>

{#snippet takeoverTitle()}
  <h2 id={dialogTitleId} class="text-lg font-semibold leading-6">
    {m.modals_interruptedAgents_title()}
  </h2>
{/snippet}

{#snippet takeoverDescription()}
  <p id={dialogDescriptionId}>{m.modals_interruptedAgents_description()}</p>
{/snippet}

{#snippet takeoverLeading()}
  <div
    class="flex size-10 items-center justify-center rounded-full bg-amber-500/20 text-amber-600 ring-1 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-400"
  >
    <Fa icon={faExclamationTriangle} size="lg" />
  </div>
{/snippet}

{#snippet takeoverActions()}
  <Button
    variant="ghost"
    size="icon-sm"
    class="-mr-1 text-subtle hover:text-foreground"
    aria-label={m.modals_interruptedAgents_close_ariaLabel()}
    onclick={close}
  >
    <Fa icon={faXmark} />
  </Button>
{/snippet}

{#snippet takeoverBody()}
  <div class="mb-3 flex items-center justify-between gap-3 px-1">
    <label class="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
      <Checkbox
        checked={allSelected}
        indeterminate={someSelected}
        ariaLabel={m.ui_shortcuts_selectAll_label()}
        onCheckedChange={toggleAll}
      />
      <span>{m.ui_shortcuts_selectAll_label()}</span>
    </label>
    <span class="type-caption tabular-nums text-muted-foreground" aria-hidden="true">
      {checkedAgents.size}/{agents.length}
    </span>
  </div>
  <CheckboxGroup
    value={[...checkedAgents]}
    onValueChange={setSelection}
    aria-label={m.modals_interruptedAgents_title()}
    class="gap-0"
  >
    <SectionedList sections={agentsByWorkspace()} getKey={(group) => group.workspaceId}>
      {#snippet header(group)}{group.workspaceName}{/snippet}
      {#snippet children(group)}
        <ListView
          items={group.agents}
          getKey={(agent) => agent.agentId}
          getText={(agent) => agent.agentName}
          selectable="multi"
          selectedKeys={[...checkedAgents]}
          onSelectedKeysChange={(keys) => (checkedAgents = new Set(keys.map(String)))}
          ariaLabel={group.workspaceName}
          class="mb-3"
        >
          {#snippet row({ item: agent })}
            <ListRow>
              {#snippet leading()}
                <Checkbox
                  checked={checkedAgents.has(agent.agentId)}
                  ariaLabel={agent.agentName}
                  onCheckedChange={() => toggleAgent(agent.agentId)}
                />
              {/snippet}
              {#snippet title()}{agent.agentName}{/snippet}
              {#snippet description()}
                {m.modals_interruptedAgents_statusLine_label({
                  status: agent.prevStatus,
                  timestamp: formatDateTime(agent.interruptedAt),
                })}
              {/snippet}
              {#snippet meta()}<Badge variant="info" dot>{agent.prevStatus}</Badge>{/snippet}
            </ListRow>
          {/snippet}
        </ListView>
      {/snippet}
    </SectionedList>
  </CheckboxGroup>
{/snippet}

{#snippet takeoverDestructive()}
  <Button variant="ghost" class="text-destructive" onclick={handleAbandonAll}>
    {m.modals_interruptedAgents_abandonAll_label()}
  </Button>
{/snippet}

{#snippet takeoverSecondary()}
  <Button variant="outline" onclick={close}>
    {m.chat_questionWizard_dismiss_label()}
    <!-- i18n-ignore (platform keyboard token) -->
    <span aria-hidden="true"><ShortcutChip>Esc</ShortcutChip></span>
  </Button>
{/snippet}

{#snippet takeoverPrimary()}
  <Button variant="primary" class="sm:min-w-[11rem]" onclick={handleResumeSelected}>
    {m.modals_interruptedAgents_resumeSelected_label()}
    <span aria-hidden="true">
      <ShortcutChip class="border-0 bg-background/15 text-background shadow-none">
        {isMac ? '⌘' : '⌃'}↵
      </ShortcutChip>
    </span>
  </Button>
{/snippet}

{#if open && agents.length > 0}
  <Portal target="body" zIndex={100}>
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      role="presentation"
      onkeydown={handleKeydown}
      onclick={close}
    >
      <div
        class="flex w-full max-w-2xl min-w-0 flex-col"
        in:springIn={{ tier: 'moderate', scale: 0.98, y: 8 }}
        out:crispOut={{ tier: 'fast', scale: 0.98 }}
      >
        <TakeoverScreen
          bind:ref={dialogEl}
          title={takeoverTitle}
          description={takeoverDescription}
          leading={takeoverLeading}
          actions={takeoverActions}
          primary={takeoverPrimary}
          secondary={takeoverSecondary}
          destructive={takeoverDestructive}
          class="max-h-[85vh] rounded-2xl border border-border shadow-xl shadow-black/20 outline-none"
          headerClass="px-6 pt-6"
          bodyClass="overflow-auto px-6 py-5"
          footerClass="bg-muted/20 px-6 py-4"
          onclick={(event) => event.stopPropagation()}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={dialogTitleId}
          aria-describedby={dialogDescriptionId}
          tabindex={-1}
          onkeydown={handleKeydown}
        >
          {@render takeoverBody()}
        </TakeoverScreen>
      </div>
    </div>
  </Portal>
{/if}
