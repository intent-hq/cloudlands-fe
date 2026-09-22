<script lang="ts">
  /**
   * In-app quit confirmation dialog (replaces the native message box when a
   * renderer window is available). Shows, before quitting/restarting:
   * a summary of affected agents and browsers, grouped into workspace rows. The primary button is
   * always "Quit"; Escape/backdrop/X = cancel.
   */
  import { FormDialog } from '$lib/components/patterns/confirm';
  import AgentAvatarStack from '$features/agent/components/agent-avatar/AgentAvatarStack.svelte';
  import Fa from 'svelte-fa';
  import { faWindowMaximize } from '@fortawesome/free-solid-svg-icons';
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
  const summary = $derived(
    interrupted.length && disruptedTabs.length
      ? m.quitConfirmation_modal_summary_both({ agents: agentCount, browsers: browserCount })
      : m.quitConfirmation_modal_summary({ count: interrupted.length ? agentCount : browserCount }),
  );

  const workspaces = $derived.by(() => {
    const groups = new Map<
      string,
      {
        key: string;
        name: string;
        agents: QuitAgentSummary[];
        browserCount: number;
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
          browserCount: 0,
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
      group(workspaceId, workspaceName).browserCount += 1;
    }
    return [...groups.values()];
  });

  let responded = $state(false);
  $effect(() => {
    if (open) responded = false;
  });

  function respond(proceed: boolean) {
    // FormDialog updates the bound open state before delivering cancellation.
    // Track the decision separately so cancellation still reaches the host.
    if (responded) return;
    responded = true;
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
    description={summary}
    descriptionId={dialogDescriptionId}
    submitLabel={m.quitConfirmation_modal_quitButton_label()}
    cancelLabel={m.quitConfirmation_modal_cancelButton_label()}
    submitVariant="destructive"
    size="default"
    focusContent
    onSubmit={() => respond(true)}
    onCancel={() => respond(false)}
  >
    <ul>
      {#each workspaces as workspace (workspace.key)}
        <li aria-label={workspace.name}>
          <ListRow class="min-h-8 gap-2 px-0 py-1">
            {#snippet title()}<span title={workspace.name}>{workspace.name}</span>{/snippet}
            {#snippet trailing()}
              {#if workspace.browserCount > 0}
                {@const browserLabel =
                  workspace.browserCount === 1
                    ? m.quitConfirmation_modal_browsers_one({ count: workspace.browserCount })
                    : m.quitConfirmation_modal_browsers_many({ count: workspace.browserCount })}
                <span
                  role="img"
                  aria-label={browserLabel}
                  title={browserLabel}
                  class="mr-1 inline-flex"
                >
                  <AgentAvatarStack
                    items={Array.from({ length: workspace.browserCount }, (_, index) => ({
                      key: `browser-${index}`,
                      agentId: `browser-${index}`,
                    }))}
                    variant="card-stack"
                    maxVisible={3}
                  >
                    {#snippet itemContent()}
                      <span
                        class="browser-stack-icon flex size-full items-center justify-center bg-muted text-muted-foreground"
                      >
                        <Fa icon={faWindowMaximize} class="size-3.5" />
                      </span>
                    {/snippet}
                  </AgentAvatarStack>
                </span>
              {/if}
              {#if workspace.agents.length > 0}
                <span data-quit-agent-stack class="inline-flex">
                  <AgentAvatarStack
                    items={workspace.agents.map((agent) => ({
                      key: agent.agentId,
                      agentId: agent.agentId,
                    }))}
                    variant="card-stack"
                  />
                </span>
              {/if}
            {/snippet}
          </ListRow>
        </li>
      {/each}
    </ul>
  </FormDialog>
{/if}

<style>
  .browser-stack-icon {
    border-radius: var(--agent-avatar-corner-radius);
  }
</style>
