<script lang="ts">
  /**
   * In-app quit confirmation dialog (replaces the native message box when a
   * renderer window is available). Shows, before quitting/restarting:
   * agents that will be interrupted, agents that keep running, and
   * agent-owned browser tabs that will be disconnected — each section only
   * when non-empty. The primary button mirrors the native copy branching:
   * "Quit" when anything is interrupted/disrupted, "Close" when only
   * keep-running agents are listed. Escape/backdrop/X = cancel.
   */
  import { FormDialog } from '$lib/components/patterns/confirm';
  import type { QuitConfirmationShowPayload } from '$shared/ipc/quit-confirmation';
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
    <div class="flex-1 space-y-5 overflow-auto">
      {#if interrupted.length > 0}
        <section class="space-y-2">
          <h3 class="text-sm font-medium text-foreground">
            {m.quitConfirmation_modal_interruptedSection_title()}
          </h3>
          <p class="text-xs text-subtle">
            {m.quitConfirmation_modal_interruptedSection_description()}
          </p>
          <ul class="space-y-1 pl-2">
            {#each interrupted as agent (agent.agentId)}
              <li class="text-sm text-foreground truncate">
                {agent.agentName}
                {#if agent.workspaceName}
                  <span class="text-xs text-subtle">— {agent.workspaceName}</span>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if keepRunning.length > 0}
        <section class="space-y-2">
          <h3 class="text-sm font-medium text-foreground">
            {m.quitConfirmation_modal_keepRunningSection_title()}
          </h3>
          <p class="text-xs text-subtle">
            {m.quitConfirmation_modal_keepRunningSection_description()}
          </p>
          <ul class="space-y-1 pl-2">
            {#each keepRunning as agent (agent.agentId)}
              <li class="text-sm text-foreground truncate">
                {agent.agentName}
                {#if agent.workspaceName}
                  <span class="text-xs text-subtle">— {agent.workspaceName}</span>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if disruptedTabs.length > 0}
        <section class="space-y-2">
          <h3 class="text-sm font-medium text-foreground">
            {m.quitConfirmation_modal_browsersSection_title()}
          </h3>
          <p class="text-xs text-subtle">
            {m.quitConfirmation_modal_browsersSection_description()}
          </p>
          <ul class="space-y-1 pl-2">
            {#each disruptedTabs as tab (tab.tabId)}
              <li class="text-sm text-foreground truncate">
                {tab.title || tab.url || m.quitConfirmation_modal_untitledTab_label()}
                {#if tab.ownerAgentName}
                  <span class="text-xs text-subtle">— {tab.ownerAgentName}</span>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </div>
  </FormDialog>
{/if}
