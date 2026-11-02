<!--
  Conversation notice for a remote agent that is starting, couldn't start, or
  whose machine can't be reached or revoked access. Nothing for a local agent
  or a remote agent that runs normally.
-->
<script lang="ts">
  import Fa from 'svelte-fa';
  import { writable } from 'svelte/store';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { faCircleExclamation, faTriangleExclamation } from '$lib/icons/phosphor-icons';
  import { OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS } from '$lib/components/chat/operational-disclosure-row';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import { m } from '$shared/paraglide/messages.js';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { agentMachineLocation, agentPlacementNoticeKind } from './agent-location';
  import {
    selectCurrentBackendLabel,
    selectRemoteMachine,
    selectRemoteMachinesVisible,
  } from './remote-machines-selectors';
  import { remoteMachinesRefreshRequested } from './remote-machines-slice';

  let { agentId }: { agentId: string } = $props();

  const agentIdStore = writable<string | undefined>(undefined);
  const machineIdStore = writable<string | undefined>(undefined);
  $effect(() => {
    agentIdStore.set(agentId);
  });
  const agent$ = selectAgentSession(agentIdStore);
  $effect(() => {
    machineIdStore.set($agent$?.nodeId);
  });
  const machine$ = selectRemoteMachine(machineIdStore);
  const machinesVisible$ = selectRemoteMachinesVisible();
  const backendLabel$ = selectCurrentBackendLabel();

  const location = $derived(agentMachineLocation($agent$, $machine$));
  const kind = $derived(agentPlacementNoticeKind($agent$, location));

  function openDevicesSettings() {
    void navigateToSettings({ tab: 'devices', hash: 'devices' });
  }
</script>

{#if location && kind === 'starting'}
  <div
    class="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 type-body font-family-child text-muted-foreground {OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS}"
    role="status"
    aria-live="polite"
    data-agent-placement-notice="starting"
  >
    <span class="inline-flex size-5 items-center justify-center" aria-hidden="true">
      <IntentMarkLoader size={14} />
    </span>
    <span>{m.remoteAgent_notice_starting_title({ machine: location.name })}</span>
    <span class="text-subtle">{m.remoteAgent_notice_starting_description()}</span>
  </div>
{:else if location && kind}
  {@const danger = kind === 'failed' || kind === 'revoked'}
  <div
    class="mt-6 w-full space-y-2 rounded-md border p-3 {danger
      ? 'border-danger/30 bg-danger-background/10'
      : 'border-warning/40 bg-warning/5'}"
    role={danger ? 'alert' : 'status'}
    data-agent-placement-notice={kind}
  >
    <div class="flex items-start gap-2">
      <Fa
        icon={danger ? faCircleExclamation : faTriangleExclamation}
        class="mt-0.5 size-3.5! shrink-0 {danger ? 'text-danger' : 'text-warning-ink'}"
      />
      <div class="min-w-0 space-y-1">
        <p class="type-body font-medium {danger ? 'text-danger' : 'text-warning-ink'}">
          {#if kind === 'failed'}
            {m.remoteAgent_notice_failed_title({ machine: location.name })}
          {:else if kind === 'unreachable'}
            {m.remoteAgent_notice_unreachable_title({ machine: location.name })}
          {:else}
            {m.remoteAgent_notice_revoked_title({ machine: location.name })}
          {/if}
        </p>
        {#if kind === 'failed'}
          {#if $agent$?.placementError?.detail}
            <p class="type-body break-words text-muted-foreground" data-agent-placement-detail>
              {$agent$.placementError.detail}
            </p>
          {/if}
          <p class="type-body text-muted-foreground">{m.remoteAgent_notice_failed_hint()}</p>
        {:else if kind === 'unreachable'}
          <p class="type-body text-muted-foreground">
            {m.remoteAgent_notice_unreachable_description({
              machine: location.name,
              backend: $backendLabel$,
            })}
          </p>
        {:else}
          <p class="type-body text-muted-foreground">
            {m.remoteAgent_notice_revoked_description({ machine: location.name })}
          </p>
        {/if}
      </div>
    </div>
    {#if kind !== 'unreachable' || $machinesVisible$}
      <div class="flex flex-wrap justify-end gap-2">
        {#if kind === 'unreachable'}
          <Button
            variant="secondary"
            size="sm"
            onclick={() => appStore.dispatch(remoteMachinesRefreshRequested())}
          >
            {m.remoteAgent_notice_checkAgain_label()}
          </Button>
        {:else}
          <Button variant="secondary" size="sm" onclick={openDevicesSettings}>
            {m.remoteAgent_notice_openDevices_label()}
          </Button>
        {/if}
      </div>
    {/if}
  </div>
{/if}
