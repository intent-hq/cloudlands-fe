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
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faExclamationTriangle, faXmark } from '@fortawesome/free-solid-svg-icons';
  import Portal from '$lib/components/ui/Portal.svelte';
  import type { QuitConfirmationShowPayload } from '$shared/ipc/quit-confirmation';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    payload?: QuitConfirmationShowPayload | null;
    /** Called exactly once per open with the user's decision. */
    onRespond?: (proceed: boolean) => void;
  }

  let { open = $bindable(false), payload = null, onRespond }: Props = $props();

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

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      respond(false);
    }
  }
</script>

{#if open && payload}
  <Portal target="body" zIndex={100}>
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      role="presentation"
      onkeydown={handleKeydown}
      onclick={() => respond(false)}
    >
      <div
        class="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl shadow-black/20 max-h-[85vh]"
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
                {closeOnly
                  ? m.quitConfirmation_modal_close_title()
                  : m.quitConfirmation_modal_quit_title()}
              </h2>
              <p class="mt-1 text-sm text-subtle">
                {closeOnly
                  ? m.quitConfirmation_modal_close_description()
                  : m.quitConfirmation_modal_quit_description()}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            class="-mr-1 mt-0.5 text-subtle hover:text-foreground"
            aria-label={m.quitConfirmation_modal_dismiss_ariaLabel()}
            onclick={() => respond(false)}
          >
            <Fa icon={faXmark} />
          </Button>
        </div>

        <div id={dialogDescriptionId} class="flex-1 overflow-auto px-6 py-5 space-y-5">
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

        <div
          class="flex flex-col-reverse gap-2 border-t border-border bg-muted/20 px-6 py-4 sm:flex-row sm:justify-end"
        >
          <Button variant="outline" onclick={() => respond(false)}>
            {m.quitConfirmation_modal_cancelButton_label()}
          </Button>
          <Button
            variant={closeOnly ? 'default' : 'destructive'}
            class="sm:min-w-[8rem]"
            onclick={() => respond(true)}
          >
            {closeOnly
              ? m.quitConfirmation_modal_closeButton_label()
              : m.quitConfirmation_modal_quitButton_label()}
          </Button>
        </div>
      </div>
    </div>
  </Portal>
{/if}
