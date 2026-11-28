<!--
  One machine the current backend can run agents on: state, platform, running
  agents, and "Stop letting <backend> run agents on this machine". Used in
  "Machines <backend> can run agents on", and under Nodes for a machine this
  app has no saved connection to (added from an intent://node link).
-->
<script lang="ts">
  import { ListRow, RowActions, type ActionDefinition } from '$lib/components/patterns/collection';
  import { faLinkSlash } from '@fortawesome/free-solid-svg-icons';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import type { RemoteMachine } from '$shared/types/remote-machines';
  import { selectConnections } from '$store/renderer/slices/connections/connections-selectors';
  import { selectRemoteScriptsSupported } from '$store/renderer/slices/scripts/scripts-selectors';
  import { store as appStore } from '$store/renderer/store';
  import RemoteMachineNotice from './RemoteMachineNotice.svelte';
  import {
    selectCurrentBackendLabel,
    selectLocalMachineFingerprint,
    selectRemoteMachineFailures,
    selectRemoteMachineOperations,
  } from './remote-machines-selectors';
  import { remoteMachineUnexposeRequested } from './remote-machines-slice';
  import { connectionForMachine, machineNeedsUpdateForScripts } from './remote-machines-utils';
  import {
    machineLoadFacts,
    needsNodeFact,
    runnerConnectionStatus,
  } from './remote-machines-messages';
  import MachineLoad from './MachineLoad.svelte';
  import DeviceIcon from '$lib/components/DeviceIcon.svelte';
  import { withOrderActions, type MachineOrderControls } from './machine-order-controls';
  import MachineName from './MachineName.svelte';
  import MachineProviderAvailability from './MachineProviderAvailability.svelte';
  import {
    machinePlatform,
    machineRowNeedsNode,
    machineRowProviders,
    machineRowReport,
  } from './machine-facts';
  import { selectProviderCatalogEntries } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';

  let {
    machine,
    highlighted = false,
    first = false,
    last = false,
    order,
  }: {
    machine: RemoteMachine;
    /** Briefly highlighted after it was added. */
    highlighted?: boolean;
    first?: boolean;
    last?: boolean;
    /** In the ordered runner list: Move up / Move down. */
    order?: MachineOrderControls;
  } = $props();

  const connections$ = selectConnections();
  const localFingerprint$ = selectLocalMachineFingerprint();
  const operations$ = selectRemoteMachineOperations();
  const failures$ = selectRemoteMachineFailures();
  const backendLabel$ = selectCurrentBackendLabel();
  const remoteScriptsSupported$ = selectRemoteScriptsSupported();
  const catalogEntries$ = selectProviderCatalogEntries();

  const connectionId = $derived(connectionForMachine(machine, $connections$, $localFingerprint$));
  const removing = $derived($operations$[machine.id] === 'removing');
  const platform = $derived(machinePlatform(machine.platform?.os));
  const platformFallback = $derived(
    machine.platform && !platform ? `${machine.platform.os} · ${machine.platform.arch}` : null, // i18n-ignore (OS/arch identifiers)
  );
  const providers = $derived.by(() => {
    const entries = $catalogEntries$;
    return machineRowProviders(
      {},
      machine,
      (id) => entries.find((entry) => entry.id === id)?.displayName,
    );
  });
  const report = $derived(machineRowReport(machine));
  const runnerStatus = $derived(
    runnerConnectionStatus(machine, { machine: machine.name, backend: $backendLabel$ }),
  );
  const needsNode = $derived.by(() => {
    const entries = $catalogEntries$;
    return machineRowNeedsNode(
      machine,
      (id) => entries.find((entry) => entry.id === id)?.displayName,
      $connections$.find((connection) => connection.id === connectionId)?.daemonMode,
    );
  });
  const facts = $derived.by(() => {
    const nodeFact = providers.length === 0 && report ? needsNodeFact(needsNode) : null;
    return [...machineLoadFacts(machine), ...(nodeFact ? [nodeFact] : [])];
  });
  const actions = $derived<ActionDefinition[]>(
    withOrderActions(
      [
        {
          id: 'unexpose',
          label: m.remoteMachines_unexposeAction_label({ backend: $backendLabel$ }),
          icon: faLinkSlash,
          disabled: removing,
        },
      ],
      order,
    ),
  );

  function onAction(id: string) {
    if (order?.onAction(id)) return;
    if (id === 'unexpose')
      appStore.dispatch(remoteMachineUnexposeRequested(machine.id, connectionId));
  }
</script>

<article
  class={cn(
    'border-t border-border transition-colors first:border-t-0',
    highlighted && 'bg-accent/60',
    highlighted && first && 'rounded-t-xl',
    highlighted && last && 'rounded-b-xl',
  )}
  aria-label={machine.name}
  data-remote-machine-row={machine.id}
  data-highlighted={highlighted || undefined}
>
  <ListRow class="items-center px-4 sm:px-5 [&>[data-slot]]:self-center">
    {#snippet leading()}
      <span class="flex items-center gap-3">
        <DeviceIcon record={{ os: machine.platform?.os }} size={20} class="text-foreground" />
      </span>
    {/snippet}
    {#snippet title()}
      <MachineName
        name={machine.name}
        {platform}
        {platformFallback}
        {providers}
        {facts}
        {runnerStatus}
      />
    {/snippet}
    {#snippet meta()}
      <span
        data-slot="machine-row-meta"
        class="inline-flex h-[1lh] items-center gap-1 align-top [&>*+*]:before:mr-1 [&>*+*]:before:content-['·']"
      >
        <MachineLoad {machine} />
        {#if machineNeedsUpdateForScripts(machine, $remoteScriptsSupported$)}
          <span class="text-warning-ink" data-machine-scripts-update
            >{m.remoteMachines_scriptsUpdate_label()}</span
          >
        {/if}
        {#if providers.length === 0 && needsNode.length > 0}
          <MachineProviderAvailability {needsNode} />
        {/if}
      </span>
    {/snippet}
    {#snippet trailing()}
      <RowActions
        alwaysVisible
        {actions}
        {onAction}
        visibleCount={0}
        overflowLabel={m.remoteMachines_actionsFor_ariaLabel({ name: machine.name })}
      />
    {/snippet}
  </ListRow>
  <RemoteMachineNotice
    failure={$failures$[machine.id] ?? null}
    failureKey={machine.id}
    {machine}
    {connectionId}
    machineLabel={machine.name}
    backendLabel={$backendLabel$}
    busy={removing}
    showStateMessage={false}
  />
</article>
