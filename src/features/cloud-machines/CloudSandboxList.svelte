<!--
  Settings → an E2B entry: its live sandboxes, of everyone who runs agents on
  this backend, grouped by workspace (running first), with who started each,
  uptime, Pause and Delete. Uptime advances locally between reads while a sandbox runs.
-->
<script lang="ts">
  import Fa from 'svelte-fa';
  import { onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import { Badge, type BadgeColor } from '$lib/components/ui/badge';
  import { ListView } from '$lib/components/patterns/collection';
  import { Button, Tooltip } from '$lib/components/patterns/settings/custom-controls';
  import { faChevronDown, faPause, faTrash } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { RemoteMachine } from '$shared/types/remote-machines';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectCloudFailures,
    selectCloudOperations,
    selectCloudSandboxReadAt,
    selectSandboxListContext,
  } from './cloud-machines-selectors';
  import { navigateToDesktopAgent } from '$features/desktop/desktop-agent-navigation';
  import { cloudMachineDeleteRequested, cloudMachinePauseRequested } from './cloud-machines-slice';
  import {
    E2B_DASHBOARD_URL,
    cloudErrorText,
    formatUptime,
    groupSandboxesByWorkspace,
    liveRunningSeconds,
    sandboxLabel,
  } from './cloud-machines-format';
  import { collapsedSandboxGroups, sandboxGroupId } from './sandbox-groups.svelte';

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
  const sandboxes$ = writable<readonly RemoteMachine[]>([]);
  $effect.pre(() => sandboxes$.set(sandboxes));
  const context$ = selectSandboxListContext(sandboxes$);

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

  const groups = $derived(
    groupSandboxesByWorkspace(sandboxes, (id) => $context$.workspaceNames[id] ?? null),
  );

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
  {#each groups as group (group.key)}
    {@const groupId = sandboxGroupId(entryName, group.key)}
    {@const open = !collapsedSandboxGroups.has(groupId)}
    <div data-cloud-sandbox-group={group.key}>
      <Button
        variant="plain"
        size="xs"
        class="-mx-1 h-7 max-w-full shrink gap-1.5 px-1 type-body text-muted-foreground hover:text-foreground"
        labelClass="text-foreground"
        aria-expanded={open}
        aria-label={(group.sandboxes.length === 1
          ? m.cloudMachines_sandboxes_group_ariaLabel_one
          : m.cloudMachines_sandboxes_group_ariaLabel_many)({
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
            {@const cloud = machine.cloud}
            {@const seconds = liveRunningSeconds(machine, $readAt$[machine.id] ?? 0, now)}
            {@const badge = stateBadge(cloud?.state ?? 'stopping')}
            {@const pending = $operations$[machine.id]}
            {@const failure = failureText(machine.id)}
            {@const label = sandboxLabel(machine, entryName)}
            {@const link = $context$.agentLinks[machine.id]}
            <div
              class="py-1"
              data-cloud-sandbox={machine.id}
              data-cloud-sandbox-state={cloud?.state}
            >
              <div class="flex items-center gap-3">
                <!-- Narrow rows drop the starter, then the uptime, so the name and state stay. -->
                <div class="@container flex min-w-0 flex-1 items-center gap-1.5 type-body">
                  {#if link}
                    <Button
                      variant="link"
                      size="sm"
                      class="h-auto min-w-16 shrink justify-start px-0 type-body text-foreground"
                      onclick={() => navigateToDesktopAgent(link.workspaceId, link.agentId)}
                      data-cloud-sandbox-agent-link>{label}</Button
                    >
                  {:else}
                    <span class="min-w-16 truncate text-foreground">{label}</span>
                  {/if}
                  <span class="shrink-0 text-muted-foreground @max-xs:hidden" aria-hidden="true"
                    >·</span
                  >
                  <span class="min-w-0 max-w-40 truncate text-muted-foreground @max-xs:hidden"
                    >{startedBy(machine)}</span
                  >
                  <span class="shrink-0 text-muted-foreground @max-3xs:hidden" aria-hidden="true"
                    >·</span
                  >
                  <span class="shrink-0 text-muted-foreground @max-3xs:hidden"
                    >{formatUptime(seconds)}</span
                  >
                  <Badge variant="dot" color={badge.color} class="ml-0.5 shrink-0"
                    >{badge.label}</Badge
                  >
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
      {/if}
    </div>
  {/each}
</section>
