<script lang="ts">
  import {
    ListRow,
    ListView,
    RowActions,
    type ActionDefinition,
  } from '$lib/components/patterns/collection';
  import { faLinkSlash } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { RemoteMachine } from '$shared/types/remote-machines';
  import { selectConnections } from '$store/renderer/slices/connections/connections-selectors';
  import { store as appStore } from '$store/renderer/store';
  import RemoteMachineBadge from './RemoteMachineBadge.svelte';
  import RemoteMachineNotice from './RemoteMachineNotice.svelte';
  import {
    selectCurrentBackendLabel,
    selectLocalMachineFingerprint,
    selectRemoteMachineFailures,
    selectRemoteMachineOperations,
    selectRemoteMachines,
    selectRemoteMachinesSupported,
  } from './remote-machines-selectors';
  import { remoteMachineUnexposeRequested } from './remote-machines-slice';
  import { connectionForMachine } from './remote-machines-utils';
  import { runningAgentsLabel } from './remote-machines-messages';

  const supported$ = selectRemoteMachinesSupported();
  const machines$ = selectRemoteMachines();
  const connections$ = selectConnections();
  const localFingerprint$ = selectLocalMachineFingerprint();
  const operations$ = selectRemoteMachineOperations();
  const failures$ = selectRemoteMachineFailures();
  const backendLabel$ = selectCurrentBackendLabel();

  function actions(machine: RemoteMachine): ActionDefinition[] {
    return [
      {
        id: 'unexpose',
        label: m.remoteMachines_unexpose_label(),
        icon: faLinkSlash,
        destructive: true,
        disabled: $operations$[machine.id] === 'removing',
      },
    ];
  }

  function platformLabel(machine: RemoteMachine): string | null {
    return machine.platform ? `${machine.platform.os} · ${machine.platform.arch}` : null; // i18n-ignore (OS/arch identifiers)
  }

  function unexpose(machine: RemoteMachine) {
    appStore.dispatch(
      remoteMachineUnexposeRequested(
        machine.id,
        connectionForMachine(machine, $connections$, $localFingerprint$),
      ),
    );
  }
</script>

{#if $supported$ && $machines$.length > 0}
  <section class="space-y-3" aria-labelledby="remote-machines-title">
    <div>
      <h3 id="remote-machines-title" class="type-title text-foreground">
        {m.remoteMachines_section_title({ backend: $backendLabel$ })}
      </h3>
      <p class="max-w-2xl type-body text-muted-foreground">
        {m.remoteMachines_section_description({ backend: $backendLabel$ })}
      </p>
    </div>
    <ListView
      virtualize={false}
      items={$machines$}
      getKey={(machine) => machine.id}
      getText={(machine) => machine.name}
      ariaLabel={m.remoteMachines_section_title({ backend: $backendLabel$ })}
      class="overflow-visible rounded-xl border border-border bg-card [&>div>div[aria-hidden=true]]:hidden"
    >
      {#snippet row({ item: machine })}
        <article class="border-t border-border first:border-t-0" aria-label={machine.name}>
          <ListRow class="items-center px-4 sm:px-5 [&>[data-slot]]:self-center">
            {#snippet title()}{machine.name}{/snippet}
            {#snippet meta()}
              <RemoteMachineBadge {machine} backendLabel={$backendLabel$} />
              {#if platformLabel(machine)}<span>{platformLabel(machine)}</span>{/if}
              {#if machine.runningAgents > 0}<span>{runningAgentsLabel(machine.runningAgents)}</span
                >{/if}
            {/snippet}
            {#snippet trailing()}
              <RowActions
                alwaysVisible
                actions={actions(machine)}
                onAction={() => unexpose(machine)}
                visibleCount={0}
                overflowLabel={m.remoteMachines_actionsFor_ariaLabel({ name: machine.name })}
              />
            {/snippet}
          </ListRow>
          <RemoteMachineNotice
            failure={$failures$[machine.id] ?? null}
            failureKey={machine.id}
            {machine}
            connectionId={connectionForMachine(machine, $connections$, $localFingerprint$)}
            machineLabel={machine.name}
            backendLabel={$backendLabel$}
            busy={$operations$[machine.id] === 'removing'}
          />
        </article>
      {/snippet}
    </ListView>
  </section>
{/if}
