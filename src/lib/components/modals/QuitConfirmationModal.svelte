<script lang="ts">
  /**
   * In-app quit confirmation dialog (replaces the native message box when a
   * renderer window is available). Shows, before quitting/restarting:
   * agents that will be interrupted, agents that keep running, and
   * agent-owned browser tabs that will be disconnected, grouped by workspace. The primary button mirrors the native copy branching:
   * "Quit" when anything is interrupted/disrupted, "Close" when only
   * keep-running agents are listed. Escape/backdrop/X = cancel.
   */
  import { FormDialog } from '$lib/components/patterns/confirm';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import WorkspaceStatusIcon from '$lib/components/workspace/WorkspaceStatusIcon.svelte';
  import type {
    QuitAgentSummary,
    QuitBrowserTabSummary,
    QuitConfirmationShowPayload,
  } from '$shared/ipc/quit-confirmation';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    static?: boolean;
    payload?: QuitConfirmationShowPayload | null;
    /** Called exactly once per open with the user's decision. */
    onRespond?: (proceed: boolean) => void;
  }

  let {
    open = $bindable(false),
    static: staticPosition = false,
    payload = null,
    onRespond,
  }: Props = $props();

  const dialogTitleId = 'quit-confirmation-dialog-title';
  const dialogDescriptionId = 'quit-confirmation-dialog-description';

  const interrupted = $derived(payload?.interrupted ?? []);
  const keepRunning = $derived(payload?.keepRunning ?? []);
  const disruptedTabs = $derived(payload?.disruptedBrowserTabs ?? []);
  /** Only keep-running agents → non-destructive "Close" framing. */
  const closeOnly = $derived(interrupted.length === 0 && disruptedTabs.length === 0);

  const workspaces = $derived.by(() => {
    const groups = new Map<
      string,
      {
        key: string;
        name: string;
        agents: { agent: QuitAgentSummary; interrupted: boolean }[];
        tabs: QuitBrowserTabSummary[];
      }
    >();
    function group(workspaceId?: string, workspaceName?: string) {
      const key = workspaceId
        ? `id:${workspaceId}`
        : workspaceName
          ? `name:${workspaceName}`
          : 'other';
      let value = groups.get(key);
      if (!value) {
        value = {
          key,
          name:
            workspaceName ||
            (workspaceId ? m.workspace_links_untitled_label() : m.workspace_links_other_label()),
          agents: [],
          tabs: [],
        };
        groups.set(key, value);
      } else if (workspaceName) {
        value.name = workspaceName;
      }
      return value;
    }
    const agents = [...interrupted, ...keepRunning];
    for (const agent of interrupted)
      group(agent.workspaceId, agent.workspaceName).agents.push({ agent, interrupted: true });
    for (const agent of keepRunning)
      group(agent.workspaceId, agent.workspaceName).agents.push({ agent, interrupted: false });
    for (const tab of disruptedTabs) {
      const owner = agents.find((agent) => agent.agentId === tab.ownerAgentId);
      const workspaceId = tab.workspaceId ?? owner?.workspaceId;
      const workspaceName =
        !tab.workspaceId || tab.workspaceId === owner?.workspaceId
          ? owner?.workspaceName
          : undefined;
      group(workspaceId, workspaceName).tabs.push(tab);
    }
    return [...groups.values()];
  });

  function respond(proceed: boolean) {
    if (!open) return;
    open = false;
    onRespond?.(proceed);
  }
</script>

{#if open && payload}
  <FormDialog
    bind:open
    static={staticPosition}
    role="alertdialog"
    title={closeOnly
      ? m.quitConfirmation_modal_close_title()
      : m.quitConfirmation_modal_quit_title()}
    description={closeOnly
      ? m.quitConfirmation_modal_close_description()
      : m.quitConfirmation_modal_quit_description()}
    titleId={dialogTitleId}
    descriptionId={dialogDescriptionId}
    submitLabel={closeOnly
      ? m.quitConfirmation_modal_closeButton_label()
      : m.quitConfirmation_modal_quitButton_label()}
    cancelLabel={m.quitConfirmation_modal_cancelButton_label()}
    submitVariant={closeOnly ? 'primary' : 'destructive'}
    class="max-w-2xl"
    focusContent
    onSubmit={() => respond(true)}
    onCancel={() => respond(false)}
  >
    <div class="flex-1 space-y-3 overflow-auto">
      {#each workspaces as workspace (workspace.key)}
        <section aria-label={workspace.name} class="space-y-1">
          <h3 class="flex min-w-0 items-center gap-2 px-2 py-1.5">
            <WorkspaceStatusIcon status="idle" size={14} decorative />
            <span class="type-body min-w-0 truncate font-normal text-foreground"
              >{workspace.name}</span
            >
          </h3>
          <ul class="space-y-1 pl-7 pr-2">
            {#each workspace.agents as { agent, interrupted: willInterrupt } (agent.agentId)}
              <li class="flex min-w-0 items-center gap-2 py-1">
                <span class="shrink-0"
                  ><AgentAvatar agentId={agent.agentId} variant="compact" /></span
                >
                <span
                  class="type-body min-w-0 flex-1 truncate text-foreground"
                  title={agent.agentName}>{agent.agentName}</span
                >
                <span
                  class="type-caption shrink-0 text-muted-foreground"
                  title={willInterrupt
                    ? m.quitConfirmation_modal_interruptedSection_description()
                    : m.quitConfirmation_modal_keepRunningSection_description()}
                >
                  {willInterrupt
                    ? m.quitConfirmation_modal_interruptedSection_title()
                    : m.quitConfirmation_modal_keepRunningSection_title()}
                </span>
              </li>
            {/each}
            {#each workspace.tabs as tab (tab.tabId)}
              <li
                class="min-w-0 py-1 text-muted-foreground"
                title={m.quitConfirmation_modal_browsersSection_description()}
              >
                <div class="type-body truncate">
                  {tab.title || tab.url || m.quitConfirmation_modal_untitledTab_label()}
                </div>
                {#if tab.title && tab.url}<div class="type-caption truncate">{tab.url}</div>{/if}
                <div class="type-caption">{m.quitConfirmation_modal_browsersSection_title()}</div>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  </FormDialog>
{/if}
