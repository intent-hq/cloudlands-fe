<script lang="ts">
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { faTerminal, faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import KebabIcon from '$lib/components/icons/KebabIcon.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { formatDateTime, formatInteger } from '$lib/i18n/format';
  import { store } from '$store/renderer/store';
  import {
    selectScriptMonitors,
    selectAgentScriptMonitors,
  } from '$store/renderer/slices/script-monitor/script-monitor-selectors';
  import { scriptMonitorActionRequested } from '$store/renderer/slices/script-monitor/script-monitor-slice';
  import {
    safeSubscriptionSlide,
    SUBSCRIPTION_ROW_GEOMETRY_CLASS,
    SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS,
    SUBSCRIPTION_LEADING_COLUMN_CLASS,
    SUBSCRIPTION_ICON_CLASS,
    SUBSCRIPTION_ICON_BUTTON_CLASS,
    SUBSCRIPTION_CHEVRON_CLASS,
    SUBSCRIPTION_CHEVRON_SIZE_CLASS,
    SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS,
    SUBSCRIPTION_WAKE_BODY_PADDING_CLASS,
  } from './subscription-disclosure';
  import { CHAT_OPERATIONAL_ICON_CLASS } from './operational-disclosure-row';

  let { workspaceId, agentId }: { workspaceId: string; agentId: string } = $props();
  const workspaceIdStore = writable('');
  const agentIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspaceId);
    agentIdStore.set(agentId);
  });
  const snapshot$ = selectScriptMonitors(workspaceIdStore);
  const monitors$ = selectAgentScriptMonitors(workspaceIdStore, agentIdStore);
  const activeMonitors = $derived($monitors$.filter((row) => row.state === 'active'));
  let expanded = $state<string | null>(null);
  function act(monitorId: string, action: 'pane' | 'bottom' | 'cancel' | 'cancelRun') {
    store.dispatch(scriptMonitorActionRequested(workspaceId, monitorId, action));
  }
</script>

{#each activeMonitors as monitor (monitor.monitorId)}
  {@const script = $snapshot$.scripts.find((item) => item.id === monitor.scriptId)}
  {@const operation = $snapshot$.operations[monitor.monitorId]}
  {@const disabled = operation?.pending || $snapshot$.status !== 'ready'}
  {@const detailsId = `script-monitor-details-${monitor.monitorId}`}
  <div
    class="min-w-0 overflow-hidden {SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS}"
    data-testid="script-monitor-row"
  >
    <div
      class="flex min-w-0 items-center {SUBSCRIPTION_ROW_GEOMETRY_CLASS} {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS}"
    >
      <span class={SUBSCRIPTION_LEADING_COLUMN_CLASS} aria-hidden="true"
        ><Fa
          icon={faTerminal}
          size={16}
          class="{CHAT_OPERATIONAL_ICON_CLASS} {SUBSCRIPTION_ICON_CLASS}"
        /></span
      >
      <Button
        variant="plain"
        class="min-w-0 flex-1 justify-start truncate p-0 text-left font-normal text-muted-foreground"
        aria-expanded={expanded === monitor.monitorId}
        aria-controls={detailsId}
        onclick={() => (expanded = expanded === monitor.monitorId ? null : monitor.monitorId)}
      >
        <span class="truncate">{monitor.scriptName}</span>
      </Button>
      <span class="shrink-0 text-muted-foreground"
        >{operation?.pending
          ? m.chat_scriptMonitor_stopping_label()
          : m.chat_scriptMonitor_active_label()}</span
      >
      <Menu.Root>
        <Menu.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="plain"
              size="icon-xs"
              class="h-6 w-6 shrink-0 {SUBSCRIPTION_ICON_BUTTON_CLASS}"
              aria-label={m.chat_scriptMonitor_actions_ariaLabel({ name: monitor.scriptName })}
              {disabled}><KebabIcon class="h-3 w-3" /></Button
            >
          {/snippet}
        </Menu.Trigger>
        <Menu.Content align="end" side="top" aria-label={monitor.scriptName}>
          <Menu.Item disabled={!script} onSelect={() => act(monitor.monitorId, 'pane')}
            >{m.workspace_shell_showInPanel_tooltip()}</Menu.Item
          >
          <Menu.Item disabled={!script} onSelect={() => act(monitor.monitorId, 'bottom')}
            >{m.workspace_shell_showInBottomBar_tooltip()}</Menu.Item
          >
          <Menu.Separator />
          <Menu.Item onSelect={() => act(monitor.monitorId, 'cancel')}
            >{m.chat_scriptMonitor_unmonitor_label()}</Menu.Item
          >
          <Menu.Item onSelect={() => act(monitor.monitorId, 'cancelRun')}
            >{m.chat_scriptMonitor_cancelRun_label()}</Menu.Item
          >
        </Menu.Content>
      </Menu.Root>
      <Button
        variant="plain"
        size="icon-xs"
        class="h-6 w-6 shrink-0 {SUBSCRIPTION_ICON_BUTTON_CLASS}"
        aria-label={monitor.scriptName}
        aria-expanded={expanded === monitor.monitorId}
        aria-controls={detailsId}
        onclick={() => (expanded = expanded === monitor.monitorId ? null : monitor.monitorId)}
      >
        <Fa
          icon={faChevronDown}
          size={16}
          class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} {SUBSCRIPTION_CHEVRON_CLASS} {expanded ===
          monitor.monitorId
            ? ''
            : 'rotate-90'}"
        />
      </Button>
    </div>
    {#if operation?.error}<p
        role="alert"
        class="type-caption text-destructive {SUBSCRIPTION_WAKE_BODY_PADDING_CLASS}"
      >
        {operation.message}
      </p>{/if}
    {#if expanded === monitor.monitorId}
      <div
        id={detailsId}
        class="grid min-w-0 gap-1 text-xs text-muted-foreground {SUBSCRIPTION_WAKE_BODY_PADDING_CLASS}"
        transition:safeSubscriptionSlide
      >
        <span
          >{m.chat_scriptMonitor_expires_description({
            time: formatDateTime(monitor.expiresAt),
          })}</span
        >
        {#if monitor.outputPattern !== undefined}<span class="whitespace-pre-wrap break-all"
            >{m.chat_scriptMonitor_pattern_description({ pattern: monitor.outputPattern })}</span
          >{/if}
        {#if monitor.lineCount !== undefined}<span
            >{m.chat_scriptMonitor_lines_description({
              count: formatInteger(monitor.lineCount),
            })}</span
          >{/if}
        {#if !script}
          <span>{m.chat_scriptMonitor_missing_description()}</span>
        {:else if script.runtime.runId && script.runtime.runId !== monitor.runId}
          <span>{m.chat_scriptMonitor_output_description()}</span>
        {/if}
      </div>
    {/if}
  </div>
{/each}
