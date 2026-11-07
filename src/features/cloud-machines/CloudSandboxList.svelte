<!--
  Settings → an E2B entry: its live sandboxes, of everyone who runs agents on
  this backend, with who started each, uptime, an estimated cost, Pause and
  Delete. Uptime and cost advance locally between reads while a sandbox runs.
-->
<script lang="ts">
  import Fa from 'svelte-fa';
  import { onDestroy } from 'svelte';
  import { Badge, type BadgeColor } from '$lib/components/ui/badge';
  import { ListView } from '$lib/components/patterns/collection';
  import { Button, Tooltip } from '$lib/components/patterns/settings/custom-controls';
  import { faPause, faTrash } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { RemoteMachine } from '$shared/types/remote-machines';
  import { store as appStore } from '$store/renderer/store';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    selectCloudFailures,
    selectCloudOperations,
    selectCloudSandboxReadAt,
  } from './cloud-machines-selectors';
  import { cloudMachineDeleteRequested, cloudMachinePauseRequested } from './cloud-machines-slice';
  import {
    E2B_DASHBOARD_URL,
    cloudErrorText,
    formatCost,
    formatUptime,
    liveRunningSeconds,
    sandboxCost,
    sandboxLabel,
  } from './cloud-machines-format';

  interface Props {
    sandboxes: RemoteMachine[];
    /** The entry's name, which prefixes each row name. */
    entryName?: string;
    /** Fixed clock for previews and tests; live otherwise. */
    now?: number;
  }

  let { sandboxes, entryName, now: fixedNow }: Props = $props();

  const readAt$ = selectCloudSandboxReadAt();
  const operations$ = selectCloudOperations();
  const failures$ = selectCloudFailures();

  let tick = $state(Date.now());
  const timer = setInterval(() => (tick = Date.now()), 30_000);
  onDestroy(() => clearInterval(timer));
  const now = $derived(fixedNow ?? tick);

  const running = $derived(sandboxes.filter((row) => row.cloud?.state === 'running').length);
  const paused = $derived(sandboxes.filter((row) => row.cloud?.state === 'paused').length);

  function stateBadge(state: string): { label: string; color: BadgeColor } {
    switch (state) {
      case 'running':
        return { label: m.cloudMachines_sandbox_running(), color: 'green' };
      case 'paused':
        return { label: m.cloudMachines_sandbox_paused(), color: 'gray' };
      case 'pausing':
        return { label: m.cloudMachines_sandbox_pausing(), color: 'amber' };
      case 'resuming':
        return { label: m.cloudMachines_sandbox_resuming(), color: 'amber' };
      default:
        return { label: m.cloudMachines_sandbox_stopping(), color: 'amber' };
    }
  }

  function workspaceName(machine: RemoteMachine): string | null {
    const id = machine.cloud?.workspaceId;
    if (!id) return null;
    const workspace = selectWorkspaceById.select(appStore.state, id);
    return workspace?.title || workspace?.name || null;
  }

  function startedBy(machine: RemoteMachine): string {
    const by = machine.cloud?.startedBy;
    return by?.displayName || by?.principalId || m.cloudMachines_sandbox_unknownStarter();
  }

  function failureText(machineId: string): string | null {
    const failure = $failures$[machineId];
    if (!failure) return null;
    if (failure.forbidden) return m.cloudMachines_error_starterOnly();
    if (failure.inUse) return m.cloudMachines_error_pauseBusy();
    return failure.cloud ? cloudErrorText(failure.cloud).description : failure.message;
  }
</script>

<section
  class="space-y-1 border-t border-border bg-muted/20 px-4 py-3 sm:px-5"
  aria-label={m.cloudMachines_sandboxes_title()}
  data-cloud-sandboxes
>
  <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-1">
    <p class="type-body text-muted-foreground">
      {m.cloudMachines_sandboxes_summary({ running: String(running), paused: String(paused) })}
    </p>
    <Button
      variant="link"
      size="sm"
      href={E2B_DASHBOARD_URL}
      target="_blank"
      rel="noopener noreferrer"
      class="h-auto px-0">{m.cloudMachines_dashboard_label()}</Button
    >
  </div>
  <ListView
    virtualize={false}
    items={sandboxes}
    getKey={(machine) => machine.id}
    getText={(machine) => sandboxLabel(machine, entryName)}
    ariaLabel={m.cloudMachines_sandboxes_title()}
    class="overflow-visible [&>div>div[aria-hidden=true]]:hidden"
  >
    {#snippet row({ item: machine })}
      {@const cloud = machine.cloud}
      {@const seconds = liveRunningSeconds(machine, $readAt$[machine.id] ?? 0, now)}
      {@const cost = sandboxCost(machine, seconds)}
      {@const badge = stateBadge(cloud?.state ?? 'stopping')}
      {@const workspace = workspaceName(machine)}
      {@const pending = $operations$[machine.id]}
      {@const failure = failureText(machine.id)}
      {@const label = sandboxLabel(machine, entryName)}
      <div class="py-1" data-cloud-sandbox={machine.id} data-cloud-sandbox-state={cloud?.state}>
        <div class="flex min-h-8 items-center gap-3">
          <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 type-body">
            <span class="truncate text-foreground">{label}</span>
            <Badge variant="dot" color={badge.color}>{badge.label}</Badge>
            <span class="flex min-w-0 flex-wrap items-center gap-x-1.5 text-muted-foreground">
              {#if workspace}<span class="truncate">{workspace}</span><span aria-hidden="true"
                  >·</span
                >{/if}
              <span>{startedBy(machine)}</span>
              <span aria-hidden="true">·</span>
              <span>{formatUptime(seconds)}</span>
              {#if cost !== null}
                <span aria-hidden="true">·</span>
                <span>{formatCost(cost)}</span>
              {/if}
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <Tooltip content={m.cloudMachines_pause_label()}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={m.cloudMachines_pauseFor_ariaLabel({ agent: label })}
                disabled={cloud?.state !== 'running' || !!pending}
                loading={pending === 'pausing'}
                onclick={() => appStore.dispatch(cloudMachinePauseRequested(machine.id))}
              >
                <Fa icon={faPause} class="size-3.5!" />
              </Button>
            </Tooltip>
            <Tooltip content={m.cloudMachines_delete_label()}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={m.cloudMachines_deleteFor_ariaLabel({ agent: label })}
                disabled={!!pending}
                loading={pending === 'deleting'}
                onclick={() => appStore.dispatch(cloudMachineDeleteRequested(machine.id))}
              >
                <Fa icon={faTrash} class="size-3.5!" />
              </Button>
            </Tooltip>
          </div>
        </div>
        {#if failure}
          <p class="type-body text-danger" role="alert">{failure}</p>
        {/if}
      </div>
    {/snippet}
  </ListView>
</section>
