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
  import RemoteMachineBadge from './RemoteMachineBadge.svelte';
  import RemoteMachineNotice from './RemoteMachineNotice.svelte';
  import {
    selectCurrentBackendLabel,
    selectLocalMachineFingerprint,
    selectRemoteMachineFailures,
    selectRemoteMachineOperations,
  } from './remote-machines-selectors';
  import { remoteMachineUnexposeRequested } from './remote-machines-slice';
  import { connectionForMachine, machineNeedsUpdateForScripts } from './remote-machines-utils';
  import { remoteMachineBadge, runningAgentsLabel } from './remote-machines-messages';
  import DeviceIcon from '$lib/components/DeviceIcon.svelte';
  import { withOrderActions, type MachineOrderControls } from './machine-order-controls';
  import PreferredMachineBadge from './PreferredMachineBadge.svelte';
  import MachinePlatformIcon from './MachinePlatformIcon.svelte';
  import MachineProviderIcons from './MachineProviderIcons.svelte';
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
    /** In the ordered machine list: the preferred mark and Move up / Move down. */
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
  const platformIcon = $derived(machinePlatform(machine.platform?.os));
  const platform = $derived(
    machine.platform ? `${machine.platform.os} · ${machine.platform.arch}` : null, // i18n-ignore (OS/arch identifiers)
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
  const needsNode = $derived.by(() => {
    const entries = $catalogEntries$;
    return machineRowNeedsNode(
      machine,
      (id) => entries.find((entry) => entry.id === id)?.displayName,
    );
  });
  // Green while the backend holds a link to it, grey without one; a
  // problem shows its badge colour, and the badge names it.
  const dot = $derived.by((): { class: string; label: string | null } => {
    if (machine.state === 'connected')
      return {
        class: 'bg-success',
        label: m.remoteMachines_state_available_label({ backend: $backendLabel$ }),
      };
    if (machine.state === 'disconnected')
      return {
        class: 'bg-muted-foreground/50',
        label: m.settings_devices_statusDisconnected_label(),
      };
    const badge = remoteMachineBadge(machine, $backendLabel$);
    return { class: badge.color === 'red' ? 'bg-danger' : 'bg-warning', label: null };
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
        <span
          class={cn(
            'size-2.5 rounded-full ring-2 ring-background outline outline-1 outline-border',
            dot.class,
          )}
          role={dot.label ? 'status' : undefined}
          aria-label={dot.label
            ? m.settings_devices_status_ariaLabel({ status: dot.label })
            : undefined}
          aria-hidden={dot.label ? undefined : 'true'}
          data-remote-machine-dot={machine.state}
        ></span>
        <DeviceIcon record={{ os: machine.platform?.os }} size={20} class="text-foreground" />
      </span>
    {/snippet}
    {#snippet title()}{machine.name}{/snippet}
    {#snippet meta()}
      <!-- Laid out like a saved machine's row (DeviceRow): platform icon,
           then the providers its last report can run. -->
      <span data-slot="machine-row-meta" class="inline-flex h-[1lh] items-center gap-1 align-top">
        {#if order?.preferred}<PreferredMachineBadge />{/if}
        {#if platformIcon}
          <MachinePlatformIcon platform={platformIcon} />
        {:else if platform}
          <span>{platform}</span>
        {/if}
        <RemoteMachineBadge {machine} backendLabel={$backendLabel$} />
        {#if machine.runningAgents > 0}<span>{runningAgentsLabel(machine.runningAgents)}</span>{/if}
        {#if machineNeedsUpdateForScripts(machine, $remoteScriptsSupported$)}
          <span class="text-warning-ink" data-machine-scripts-update
            >{m.remoteMachines_scriptsUpdate_label()}</span
          >
        {/if}
        <MachineProviderIcons {providers} reported={!!report} {needsNode} />
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
  />
</article>
