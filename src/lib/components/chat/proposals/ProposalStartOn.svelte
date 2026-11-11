<script lang="ts">
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { faDesktop } from '@fortawesome/free-solid-svg-icons';
  import { faCloud } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { AgentSession } from '$shared/types';
  import StartOnPicker from '$lib/components/workspace/initializer/StartOnPicker.svelte';
  import {
    initialAgentPlacement,
    START_ON_BACKEND,
    startOnCloudId,
    startOnCloudMachineId,
    type StartOnPlacement,
  } from '$features/remote-machines/start-on';
  import {
    selectInitialAgentPlacementSupported,
    selectRemoteMachinesVisible,
    selectStartOnCloud,
    selectStartOnRows,
  } from '$features/remote-machines/remote-machines-selectors';
  import { selectCloudEntriesSupported } from '$features/cloud-machines/cloud-machines-selectors';
  import { proposalStartOnChoices, resolveImplicitE2b } from './proposal-start-on';

  interface Props {
    /** Selected Start on id (`''` = the backend). */
    value: string;
    /** The card's default, shown even when it can't start an agent now. */
    defaultValue: string;
    proposer?: Pick<AgentSession, 'nodeId' | 'nodeName'> | null;
    /** Provider the new agent would use, for the E2B checks. */
    providerRef?: string;
    /** New repositories start on the backend. */
    backendOnly?: boolean;
    /** Out: `undefined` while the row is hidden, `null` for the backend. */
    placement?: StartOnPlacement | null;
    /** Out: the chosen machine can't start an agent now. */
    unavailable?: boolean;
  }

  let {
    value = $bindable(),
    defaultValue,
    proposer = null,
    providerRef,
    backendOnly = false,
    placement = $bindable(),
    unavailable = $bindable(false),
  }: Props = $props();

  const remoteVisible$ = selectRemoteMachinesVisible();
  const supported$ = selectInitialAgentPlacementSupported();
  const rows$ = selectStartOnRows();
  const providerRefStore = writable<string | undefined>(undefined);
  $effect(() => {
    providerRefStore.set(providerRef);
  });
  const cloud$ = selectStartOnCloud(providerRefStore);
  const cloudEntries$ = selectCloudEntriesSupported();

  // Shown only while there is another place to choose: a remote machine or a saved E2B entry.
  const enabled = $derived($remoteVisible$ && $supported$);
  const active = $derived(enabled && $rows$.length > 1);
  const effective = $derived(backendOnly ? START_ON_BACKEND : resolveImplicitE2b(value, $rows$));
  function missingLabelFor(id: string): string {
    return startOnCloudMachineId(id)
      ? m.cloudMachines_startOn_label()
      : (id === proposer?.nodeId && proposer?.nodeName?.trim()) ||
          m.remoteAgent_location_unknownMachine();
  }
  const missingLabel = $derived(missingLabelFor(effective));
  // Nothing to choose, yet the proposal named a place that is gone: it starts on the backend.
  const goneNote = $derived(
    enabled && !active && !backendOnly && defaultValue !== START_ON_BACKEND
      ? m.chat_proposalCard_startOnGone_label({
          machine: missingLabelFor(defaultValue),
          backend: $rows$[0]?.label ?? '',
        })
      : null,
  );
  const choices = $derived(
    proposalStartOnChoices(
      $rows$.map((option) => {
        if (option.kind !== 'cloud') return option;
        const reason = $cloud$?.find(
          (entry) => startOnCloudId(entry.cloudMachineId) === option.id,
        )?.unavailableReason;
        return reason ? { ...option, disabled: true, reason, hint: undefined } : option;
      }),
      effective,
      missingLabel,
    ),
  );

  $effect(() => {
    unavailable = active && choices.unavailable !== null;
    // With nothing to choose the card starts on the backend: say so, so no payload placement wins.
    placement = active
      ? (initialAgentPlacement(effective, {
          cloudEntries: $cloudEntries$,
        }) ?? null)
      : enabled
        ? null
        : undefined;
  });
</script>

{#if active}
  <div
    class="flex min-w-0 items-center gap-3 px-3 py-2.5"
    data-row="metadata"
    data-testid="proposal-start-on"
    role="group"
    aria-label={m.chat_proposalCard_startOn_label()}
  >
    <span
      class="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground shadow-xs"
      aria-hidden="true"
    >
      <Fa icon={startOnCloudMachineId(effective) ? faCloud : faDesktop} class="size-3.5" />
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-center gap-1">
        <StartOnPicker
          presentation="metadata"
          label={m.chat_proposalCard_startOn_label()}
          value={effective}
          options={choices.options}
          onChange={(id) => (value = id)}
          lockedReason={backendOnly
            ? m.workspace_initialAgentPicker_startOnNewRepo_description({
                backend: choices.options[0]?.label ?? '',
              })
            : undefined}
        />
      </div>
      {#if choices.unavailable}
        <p class="type-caption mt-1 text-warning-ink" data-testid="proposal-start-on-warning">
          {m.chat_proposalCard_startOnUnavailable_warning({ machine: choices.unavailable.label })}
        </p>
      {/if}
    </div>
  </div>
{/if}
{#if goneNote}
  <p class="type-caption px-3 py-2.5 text-muted-foreground" data-testid="proposal-start-on-gone">
    {goneNote}
  </p>
{/if}
