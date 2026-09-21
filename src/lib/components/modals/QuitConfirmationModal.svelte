<script lang="ts">
  /**
   * In-app quit confirmation dialog (replaces the native message box when a
   * renderer window is available). Shows, before quitting/restarting:
   * a summary of affected agents and browsers, grouped into workspace rows. The primary button is
   * always "Quit"; Escape/backdrop/X = cancel.
   */
  import { FormDialog } from '$lib/components/patterns/confirm';
  import AgentAvatarStack from '$features/agent/components/agent-avatar/AgentAvatarStack.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { ListRow } from '$lib/components/patterns/collection';
  import type {
    QuitAgentSummary,
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
  const disruptedTabs = $derived(payload?.disruptedBrowserTabs ?? []);

  const agentCount = $derived(
    interrupted.length === 1
      ? m.quitConfirmation_modal_agents_one({ count: interrupted.length })
      : m.quitConfirmation_modal_agents_many({ count: interrupted.length }),
  );
  const browserCount = $derived(
    disruptedTabs.length === 1
      ? m.quitConfirmation_modal_browsers_one({ count: disruptedTabs.length })
      : m.quitConfirmation_modal_browsers_many({ count: disruptedTabs.length }),
  );

  const workspaces = $derived.by(() => {
    const groups = new Map<
      string,
      {
        key: string;
        name: string;
        agents: QuitAgentSummary[];
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
        };
        groups.set(key, value);
      } else if (workspaceName) {
        value.name = workspaceName;
      }
      return value;
    }
    const agents = interrupted;
    for (const agent of interrupted)
      group(agent.workspaceId, agent.workspaceName).agents.push(agent);
    for (const tab of disruptedTabs) {
      const owner = agents.find((agent) => agent.agentId === tab.ownerAgentId);
      const workspaceId = tab.workspaceId ?? owner?.workspaceId;
      const workspaceName =
        !tab.workspaceId || tab.workspaceId === owner?.workspaceId
          ? owner?.workspaceName
          : undefined;
      group(workspaceId, workspaceName);
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
    title={m.quitConfirmation_modal_quit_title()}
    titleId={dialogTitleId}
    submitLabel={m.quitConfirmation_modal_quitButton_label()}
    cancelLabel={m.quitConfirmation_modal_cancelButton_label()}
    submitVariant="destructive"
    class="max-w-2xl"
    focusContent
    onSubmit={() => respond(true)}
    onCancel={() => respond(false)}
  >
    <div class="flex-1 space-y-4 overflow-auto">
      <Dialog.Description id={dialogDescriptionId}>
        {#if interrupted.length && disruptedTabs.length}
          {m.quitConfirmation_modal_summary_both({ agents: agentCount, browsers: browserCount })}
        {:else}
          {m.quitConfirmation_modal_summary({
            count: interrupted.length ? agentCount : browserCount,
          })}
        {/if}
      </Dialog.Description>
      <ul class="space-y-1">
        {#each workspaces as workspace (workspace.key)}
          <li aria-label={workspace.name}>
            <ListRow>
              {#snippet title()}{workspace.name}{/snippet}
              {#snippet trailing()}
                <AgentAvatarStack
                  items={workspace.agents.map((agent) => ({
                    key: agent.agentId,
                    agentId: agent.agentId,
                  }))}
                  variant="standard"
                />
              {/snippet}
            </ListRow>
          </li>
        {/each}
      </ul>
    </div>
  </FormDialog>
{/if}
