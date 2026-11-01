<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import type { RemoteMachine, RemoteMachineFailure } from '$shared/types/remote-machines';
  import { store as appStore } from '$store/renderer/store';
  import {
    remoteMachineExposeRequested,
    remoteMachineFailureDismissed,
    remoteMachineUnexposeRequested,
  } from './remote-machines-slice';
  import {
    remoteMachineFailureMessage,
    remoteMachineFailureRetry,
    remoteMachineStateMessage,
  } from './remote-machines-messages';

  interface Props {
    /** Failure of the last operation on this row, keyed by `failureKey`. */
    failure: RemoteMachineFailure | null;
    failureKey: string;
    /** The exposed machine, for its state explanation and un-expose retries. */
    machine: RemoteMachine | null;
    /** Saved connection of the machine (listener retry, revoke on un-expose). */
    connectionId: string | null;
    machineLabel: string;
    backendLabel: string;
    busy?: boolean;
    /** Offered on a machine update-required failure when the row can update that machine. */
    onUpdateMachine?: () => void;
  }

  let {
    failure,
    failureKey,
    machine,
    connectionId,
    machineLabel,
    backendLabel,
    busy = false,
    onUpdateMachine,
  }: Props = $props();

  const labels = $derived({ machine: machineLabel, backend: backendLabel });
  const stateMessage = $derived(machine ? remoteMachineStateMessage(machine, labels) : null);
  const retry = $derived(failure ? remoteMachineFailureRetry(failure) : null);

  function exposeWith(listener: 'wss' | 'tailcat') {
    if (connectionId) appStore.dispatch(remoteMachineExposeRequested(connectionId, listener));
  }

  function stopAgentsAndRemove() {
    if (machine) appStore.dispatch(remoteMachineUnexposeRequested(machine.id, connectionId, true));
  }
</script>

{#if failure}
  <div
    class="mx-4 mb-3 space-y-2 rounded-md border border-danger/30 bg-danger-background/10 p-3 sm:mx-5"
    role="alert"
  >
    <p class="type-body text-danger">{remoteMachineFailureMessage(failure, labels)}</p>
    {#if failure.attempts?.length}
      <ul class="list-disc pl-5 type-body text-muted-foreground">
        {#each failure.attempts as attempt (attempt.route)}
          <li>{m.remoteMachines_failure_attempt_label(attempt)}</li>
        {/each}
      </ul>
    {/if}
    <div class="flex flex-wrap justify-end gap-2">
      {#if failure.code === 'listener-off' && connectionId}
        <Button variant="secondary" size="sm" disabled={busy} onclick={() => exposeWith('wss')}>
          {m.remoteMachines_failure_listenerWss_label()}
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onclick={() => exposeWith('tailcat')}>
          {m.remoteMachines_failure_listenerTailcat_label()}
        </Button>
      {:else if retry === 'stop-agents' && machine}
        <Button variant="destructive" size="sm" disabled={busy} onclick={stopAgentsAndRemove}>
          {m.remoteMachines_failure_stopAgents_label()}
        </Button>
      {:else if retry === 'retry-stop-agents' && machine}
        <Button variant="secondary" size="sm" disabled={busy} onclick={stopAgentsAndRemove}>
          {m.remoteMachines_failure_retryStopAgents_label()}
        </Button>
      {:else if failure.code === 'machine-update-required' && failure.update !== 'backend' && onUpdateMachine}
        <Button variant="secondary" size="sm" disabled={busy} onclick={onUpdateMachine}>
          {m.layout_daemonStatus_update_action()}
        </Button>
      {/if}
      <Button
        variant="ghost"
        size="sm"
        onclick={() => appStore.dispatch(remoteMachineFailureDismissed(failureKey))}
      >
        {m.remoteMachines_failure_dismiss_label()}
      </Button>
    </div>
  </div>
{:else if stateMessage}
  <p class="px-4 pb-3 type-body text-muted-foreground sm:px-5" role="status">{stateMessage}</p>
{/if}
