<!--
  One remote agent's run of a saved script on its machine, listed under the
  script in the bottom-pane script list (`remoteScripts: 1`): the machine, the
  run's status ("Lost: <reason>" when its machine disconnected) and Stop /
  Restart. A stopped run can be removed (`script.stop` dismisses it). The
  app never starts a machine run; only its remote agent can.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import { faRotateRight, faStop, faXmark } from '@fortawesome/free-solid-svg-icons';
  import { ListItem } from '$lib/components/ui/list';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import { agentMachineTooltip } from '$features/remote-machines/agent-location';
  import { selectRemoteMachine } from '$features/remote-machines/remote-machines-selectors';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { machineRunOperationRequested } from '$store/renderer/slices/scripts/scripts-slice';
  import { store as appStore } from '$store/renderer/store';
  import type { ScriptMachineRun } from '../types';
  import { isLiveScriptStatus } from '../utils/script-status';
  import { machineRunLocation, machineRunStatus } from '../utils/script-location';
  import ScriptMachineLabel from './ScriptMachineLabel.svelte';

  interface Props {
    workspaceId: string;
    scriptId: string;
    run: ScriptMachineRun;
    active?: boolean;
    onSelect?: () => void;
  }

  let { workspaceId, scriptId, run, active = false, onSelect }: Props = $props();

  const agentIdStore = writable<string | undefined>(untrack(() => run.remoteAgentId));
  const machineIdStore = writable<string | undefined>(untrack(() => run.nodeId));
  $effect(() => {
    agentIdStore.set(run.remoteAgentId);
    machineIdStore.set(run.nodeId);
  });
  const agent$ = selectAgentSession(agentIdStore);
  const machine$ = selectRemoteMachine(machineIdStore);
  const location = $derived(machineRunLocation(run, $agent$, $machine$));
  const status = $derived(machineRunStatus(run.runtime));
  const dotClass = $derived(
    status.kind === 'running' || status.kind === 'succeeded'
      ? 'bg-success'
      : status.kind === 'restarting' || status.kind === 'lost'
        ? 'bg-warning'
        : status.kind === 'failed'
          ? 'bg-danger'
          : 'bg-muted-foreground/40',
  );

  function request(operation: 'stop' | 'restart') {
    appStore.dispatch(
      machineRunOperationRequested(
        workspaceId,
        scriptId,
        run.remoteAgentId,
        operation,
        operation === 'stop'
          ? m.terminal_quakeOverlay_stopScriptFailed_error()
          : m.terminal_quakeOverlay_restartScriptFailed_error(),
      ),
    );
  }

  const actions = $derived.by(() => {
    const live = isLiveScriptStatus(run.runtime.status);
    return [
      ...(live
        ? [
            {
              icon: faStop,
              label: m.terminal_quakeOverlay_stop_label(),
              onClick: () => request('stop'),
            },
          ]
        : []),
      {
        icon: faRotateRight,
        label: m.terminal_quakeOverlay_restart_label(),
        onClick: () => request('restart'),
      },
      ...(live
        ? []
        : [
            {
              icon: faXmark,
              label: m.scripts_remote_dismissRun_label(),
              onClick: () => request('stop'),
            },
          ]),
    ];
  });
</script>

<div data-machine-run={run.remoteAgentId} data-machine-run-status={status.kind}>
  <ListItem
    size="sm"
    indent={1}
    class="pr-1.5! pl-1.5!"
    title={m.scripts_remote_runsOn_label({ machine: location.name })}
    subtitle={status.label}
    subtitleClass={status.kind === 'lost' ? 'text-warning-ink' : undefined}
    aria-label={m.remoteAgent_location_tooltipWithState({
      location: agentMachineTooltip(location),
      state: status.label,
    })}
    {active}
    onclick={() => onSelect?.()}
    {actions}
    actionsVisible="hover"
    actionsClass="absolute right-0 top-1/2 -translate-y-1/2 bg-background px-1 rounded"
  >
    {#snippet iconSnippet()}
      <div class="flex items-center justify-center w-4">
        <div
          class={cn('w-2 h-2 rounded-full', dotClass)}
          title={status.label}
          role="img"
          aria-label={status.label}
        ></div>
      </div>
    {/snippet}
    {#snippet children()}
      <ScriptMachineLabel {run} variant="icon" />
    {/snippet}
  </ListItem>
</div>
