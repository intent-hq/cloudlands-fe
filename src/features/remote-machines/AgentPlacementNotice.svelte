<!--
  Conversation notice for a remote agent that is starting (preparing its
  checkout or running setup), couldn't start, whose setup script failed, or
  whose machine can't be reached or revoked access. The checkout and setup
  output opens here as a read-only log. Nothing for a local agent or a remote
  agent that runs normally.
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
  import {
    agentMachineLocation,
    agentPlacementNoticeKind,
    placementFailure,
  } from './agent-location';
  import RemoteSetupLog from './RemoteSetupLog.svelte';
  import {
    cloudErrorText,
    E2B_DASHBOARD_URL,
  } from '$features/cloud-machines/cloud-machines-format';
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
  const setup = $derived($agent$?.setup);
  const failure = $derived(
    location && $agent$?.placementError
      ? placementFailure($agent$.placementError, location.name)
      : null,
  );
  const startingDescription = $derived(
    setup?.state === 'running'
      ? m.remoteAgent_notice_runningSetup_description()
      : setup?.state === 'pending'
        ? m.remoteAgent_notice_preparing_description()
        : m.remoteAgent_notice_starting_description(),
  );
  const cloudStep = $derived($agent$?.cloudStart?.step);
  // Without typed data only the backend's detail says why; keep it over a generic reason.
  const cloudFailure = $derived.by(() => {
    if (!failure?.cloud) return null;
    const text = cloudErrorText(failure.cloud);
    return failure.cloudDetailKnown || !failure.message
      ? text
      : { title: text.title, description: failure.message };
  });
  const startingStep = $derived(
    cloudStep === 'creating-sandbox'
      ? m.cloudMachines_start_creating()
      : cloudStep === 'starting-daemon'
        ? m.cloudMachines_start_daemon()
        : cloudStep === 'connecting'
          ? m.cloudMachines_start_connecting()
          : setup?.state === 'running'
            ? m.remoteAgent_status_runningSetup()
            : setup?.state === 'pending'
              ? m.remoteAgent_status_preparingCheckout()
              : null,
  );
  const startingTitle = $derived(
    location?.cloud
      ? m.cloudMachines_start_title()
      : m.remoteAgent_notice_starting_title({ machine: location?.name ?? '' }),
  );
  const setupFailedDescription = $derived(
    setup?.exitCode !== undefined
      ? m.remoteAgent_notice_setupFailed_exitCode({ code: String(setup.exitCode) })
      : setup?.error?.startsWith('node-setup-timeout')
        ? m.remoteAgent_notice_setupFailed_timeout()
        : m.remoteAgent_notice_setupFailed_generic(),
  );
  // The log can be opened once the machine sends output, or while setup runs.
  const canShowOutput = $derived(
    !!setup && (!!setup.output || setup.state === 'running' || setup.state === 'failed'),
  );
  let outputOpen = $state(false);

  function openMachinesSettings() {
    void navigateToSettings({ tab: 'devices', hash: 'devices' });
  }
</script>

{#snippet outputToggle()}
  {#if canShowOutput}
    <Button
      variant="ghost-light"
      size="compact"
      class="-my-1 ml-auto shrink-0"
      aria-expanded={outputOpen}
      onclick={() => (outputOpen = !outputOpen)}
    >
      {outputOpen ? m.remoteAgent_setup_hideOutput() : m.remoteAgent_setup_showOutput()}
    </Button>
  {/if}
{/snippet}

{#if location && kind === 'starting'}
  <div
    class="space-y-1.5 py-1.5 {OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS}"
    data-agent-placement-notice="starting"
    data-agent-setup-state={setup?.state}
  >
    <div class="flex items-center gap-2 type-body font-family-child text-muted-foreground">
      <span
        class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"
        role="status"
        aria-live="polite"
      >
        <span class="inline-flex size-5 items-center justify-center" aria-hidden="true">
          <IntentMarkLoader size={14} />
        </span>
        <span>{startingTitle}</span>
        {#if startingStep}
          <span class="text-foreground">{startingStep}</span>
        {/if}
        <span class="text-subtle">{startingDescription}</span>
      </span>
      {@render outputToggle()}
    </div>
    {#if outputOpen && canShowOutput}
      <RemoteSetupLog
        machine={location.name}
        output={setup?.output}
        truncated={setup?.outputTruncated}
      />
    {/if}
  </div>
{:else if location && kind === 'setup-failed'}
  <div
    class="space-y-1.5 py-1.5 {OPERATIONAL_ASSISTANT_PROSE_INSET_CLASS}"
    data-agent-placement-notice="setup-failed"
  >
    <div class="flex items-center gap-2 type-body font-family-child">
      <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5" role="status">
        <span class="inline-flex size-5 items-center justify-center" aria-hidden="true">
          <Fa icon={faTriangleExclamation} class="size-3.5! text-warning-ink" />
        </span>
        <span class="font-medium text-warning-ink">
          {m.remoteAgent_notice_setupFailed_title({ machine: location.name })}
        </span>
        <span class="text-subtle">{setupFailedDescription}</span>
      </span>
      {@render outputToggle()}
    </div>
    {#if outputOpen && canShowOutput}
      <RemoteSetupLog
        machine={location.name}
        output={setup?.output}
        truncated={setup?.outputTruncated}
      />
    {/if}
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
          {#if kind === 'failed' && cloudFailure}
            {cloudFailure.title}
          {:else if kind === 'failed'}
            {m.remoteAgent_notice_failed_title({ machine: location.name })}
          {:else if kind === 'unreachable'}
            {m.remoteAgent_notice_unreachable_title({ machine: location.name })}
          {:else}
            {m.remoteAgent_notice_revoked_title({ machine: location.name })}
          {/if}
        </p>
        {#if kind === 'failed' && cloudFailure}
          <p class="type-body text-muted-foreground" data-agent-placement-detail>
            {cloudFailure.description}
          </p>
        {:else if kind === 'failed'}
          {#if failure?.message}
            <p class="type-body break-words text-muted-foreground" data-agent-placement-detail>
              {failure.message}
            </p>
          {/if}
          <p class="type-body text-muted-foreground">
            {failure?.updateRequired
              ? m.remoteAgent_notice_updateRequired_hint({ machine: location.name })
              : m.remoteAgent_notice_failed_hint()}
          </p>
        {:else if kind === 'unreachable'}
          <p class="type-body text-muted-foreground">
            {m.remoteAgent_notice_unreachable_description({
              machine: location.name,
              backend: $backendLabel$,
            })}
          </p>
        {:else}
          <p class="type-body text-muted-foreground">
            {m.remoteAgent_notice_revoked_description({
              machine: location.name,
              backend: $backendLabel$,
            })}
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
          <Button variant="secondary" size="sm" onclick={openMachinesSettings}>
            {m.remoteAgent_notice_openMachines_label()}
          </Button>
          {#if failure?.cloud && failure.cloud.code !== 'cloud-profile-required'}
            <Button
              variant="ghost"
              size="sm"
              href={E2B_DASHBOARD_URL}
              target="_blank"
              rel="noopener noreferrer">{m.cloudMachines_dashboardOpen_label()}</Button
            >
          {/if}
        {/if}
      </div>
    {/if}
  </div>
{/if}
