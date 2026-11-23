<!--
  Settings → a cloud entry: its live sandboxes (Northflank services, Agent37 instances) and the relay they use, of everyone who runs agents on
  this backend, grouped by workspace (running first), with who started each,
  uptime, Pause and Delete. The runner row above carries the counts and opens this list.
  Uptime advances locally between reads while a sandbox runs.
-->
<script lang="ts">
  import Fa from 'svelte-fa';
  import { onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import type { BadgeColor } from '$lib/components/ui/badge';
  import { cn } from '$lib/utils';
  import { ListView } from '$lib/components/patterns/collection';
  import { Button, Tooltip } from '$lib/components/patterns/settings/custom-controls';
  import { faChevronDown, faPause, faTrash } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { RemoteMachine } from '$shared/types/remote-machines';
  import type { CloudProviderKind } from '$shared/types/cloud-machines';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectCloudFailures,
    selectCloudOperations,
    selectCloudSandboxReadAt,
    selectSandboxListContext,
    type SandboxAgentLink,
  } from './cloud-machines-selectors';
  import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
  import { navigateToDesktopAgent } from '$features/desktop/desktop-agent-navigation';
  import { cloudMachineDeleteRequested, cloudMachinePauseRequested } from './cloud-machines-slice';
  import {
    cloudEntryRelayLabel,
    cloudErrorText,
    formatUptime,
    groupSandboxesByWorkspace,
    liveRunningSeconds,
    sandboxLabel,
    cloudProviderCopy,
  } from './cloud-machines-format';
  import { collapsedSandboxGroups, sandboxGroupId } from './sandbox-groups.svelte';

  interface Props {
    sandboxes: RemoteMachine[];
    /** The entry's name, which prefixes each row name. */
    entryName?: string;
    /** The entry's provider: Northflank runs services and Agent37 instances, not sandboxes. */
    provider?: CloudProviderKind;
    /** Fixed clock for previews and tests; live otherwise. */
    now?: number;
  }

  let { sandboxes, entryName, provider = 'e2b', now: fixedNow }: Props = $props();
  const copy = $derived(cloudProviderCopy(provider));

  const readAt$ = selectCloudSandboxReadAt();
  const operations$ = selectCloudOperations();
  const failures$ = selectCloudFailures();
  const sandboxes$ = writable<readonly RemoteMachine[]>([]);
  $effect.pre(() => sandboxes$.set(sandboxes));
  const context$ = selectSandboxListContext(sandboxes$);

  let tick = $state(Date.now());
  const timer = setInterval(() => (tick = Date.now()), 30_000);
  onDestroy(() => clearInterval(timer));
  const now = $derived(fixedNow ?? tick);

  const relay = $derived(cloudEntryRelayLabel(sandboxes));

  const DOT_CLASS: Record<string, string> = {
    green: 'bg-success',
    gray: 'bg-muted-foreground/60',
    amber: 'bg-warning',
  };

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

  const groups = $derived(
    groupSandboxesByWorkspace(sandboxes, (id) => $context$.workspaceNames[id] ?? null),
  );

  // Pending deletions live outside the store; the 30 s clock re-reads them.
  function activeLink(link: SandboxAgentLink | null | undefined, _now: number) {
    return link && !isAgentDeletionPending(link.agentId) ? link : null;
  }

  function toggleGroup(id: string) {
    if (collapsedSandboxGroups.has(id)) collapsedSandboxGroups.delete(id);
    else collapsedSandboxGroups.add(id);
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
    return failure.cloud ? cloudErrorText(failure.cloud, provider).description : failure.message;
  }
</script>

{#snippet sandboxRow(machine: RemoteMachine, workspace: string | null)}
  {@const cloud = machine.cloud}
  {@const seconds = liveRunningSeconds(machine, $readAt$[machine.id] ?? 0, now)}
  {@const badge = stateBadge(cloud?.state ?? 'stopping')}
  {@const pending = $operations$[machine.id]}
  {@const failure = failureText(machine.id)}
  {@const label = sandboxLabel(machine, entryName)}
  {@const link = activeLink($context$.agentLinks[machine.id], now)}
  <div class="py-1.5" data-cloud-sandbox={machine.id} data-cloud-sandbox-state={cloud?.state}>
    <div class="flex items-center gap-3">
      <div class="flex min-w-0 flex-1 items-start gap-2.5">
        <Tooltip content={badge.label} class="first-line-icon">
          <span
            role="img"
            aria-label={badge.label}
            class={cn('size-2 rounded-full', DOT_CLASS[badge.color])}
            data-cloud-sandbox-status
          ></span>
        </Tooltip>
        <div class="min-w-0 flex-1">
          {#if link}
            <Button
              variant="link"
              size="sm"
              class="h-auto max-w-full justify-start px-0 type-caption text-foreground"
              onclick={() => navigateToDesktopAgent(link.workspaceId, link.agentId)}
              data-cloud-sandbox-agent-link>{label}</Button
            >
          {:else}
            <p class="truncate type-caption text-foreground">{label}</p>
          {/if}
          <p class="truncate type-caption text-muted-foreground" data-cloud-sandbox-details>
            {#if workspace}<span data-cloud-sandbox-workspace>{workspace}</span
              >{' · '}{/if}{startedBy(machine)}{' · '}{formatUptime(seconds)}
          </p>
        </div>
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
      <p class="pl-4.5 type-caption text-danger" role="alert">{failure}</p>
    {/if}
  </div>
{/snippet}

<section class="space-y-1 px-4 pb-3 sm:px-5" aria-label={copy.listTitle} data-cloud-sandboxes>
  {#if relay}<p class="type-caption text-muted-foreground" data-cloud-relay>{relay}</p>{/if}
  {#each groups as group (group.key)}
    {#if group.sandboxes.length === 1}
      <!-- One sandbox needs no group: its workspace shows in the row. -->
      {@render sandboxRow(group.sandboxes[0], group.key ? group.name : null)}
    {:else}
      {@const groupId = sandboxGroupId(entryName, group.key)}
      {@const open = !collapsedSandboxGroups.has(groupId)}
      <div data-cloud-sandbox-group={group.key}>
        <Button
          variant="plain"
          size="xs"
          class="-mx-1 h-7 max-w-full shrink gap-1.5 px-1 type-caption text-muted-foreground hover:text-foreground"
          labelClass="text-foreground"
          aria-expanded={open}
          aria-label={m.cloudMachines_sandboxes_group_ariaLabel_many({
            workspace: group.name,
            count: String(group.sandboxes.length),
          })}
          onclick={() => toggleGroup(groupId)}
          data-cloud-sandbox-group-toggle
        >
          {#snippet leadingIcon()}
            <span
              class="transition-transform duration-spring-moderate ease-spring-moderate motion-reduce:transition-none {open
                ? ''
                : '-rotate-90'}"
            >
              <Fa icon={faChevronDown} size="xs" />
            </span>
          {/snippet}
          {group.name}
          {#snippet trailingIcon()}
            <span aria-hidden="true">·</span>
            <span class="ml-1.5">{group.sandboxes.length}</span>
          {/snippet}
        </Button>
        {#if open}
          <ListView
            virtualize={false}
            items={group.sandboxes}
            getKey={(machine) => machine.id}
            getText={(machine) => sandboxLabel(machine, entryName)}
            ariaLabel={group.name}
            class="overflow-visible pb-1 pl-5 [&>div>div[aria-hidden=true]]:hidden"
          >
            {#snippet row({ item: machine })}
              {@render sandboxRow(machine, null)}
            {/snippet}
          </ListView>
        {/if}
      </div>
    {/if}
  {/each}
</section>
