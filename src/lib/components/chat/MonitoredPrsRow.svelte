<script lang="ts">
  /**
   * MonitoredPrsRow Component
   *
   * Faint row above the chat input (rendered ABOVE the background-hooks row
   * when both exist) surfacing the active agent's monitored PRs (PROTOCOL
   * §6.9): one small chip per active monitor. The chip label shows
   * "#<number>", prefixed with "<org/repo>: " only when the PR's repo
   * differs from the workspace repository. Hovering shows a last-refresh
   * details card (title, state, checks/reviews/threads summary,
   * mergeable/blocked reason, last-change time, pending-emit status);
   * clicking opens an action menu — flush now (`prMonitor.flush`), cancel
   * monitor (`prMonitor.cancel`), open the PR in the external browser.
   * Hidden entirely when the agent has no active monitors.
   *
   * All wire traffic lives in the `prMonitor` slice + its companion read
   * saga (`pr-monitor-saga`): this component only dispatches
   * the subscribe/unsubscribe + flush/cancel triggers and renders from the
   * selector.
   */

  import Fa from 'svelte-fa';
  import {
    faArrowUpRightFromSquare,
    faCodePullRequest,
    faPaperPlane,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import { safeSlide } from '$lib/utils/animations';
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger, formatTime } from '$lib/i18n/format';
  import { handleLink } from '$features/navigation/link-handler';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';
  import { selectAgentPrMonitors } from '$store/renderer/slices/pr-monitor/pr-monitor-selectors';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    cancelPrMonitorRequested,
    flushPrMonitorRequested,
    prMonitorsSubscribeRequested,
    prMonitorsUnsubscribeRequested,
  } from '$store/renderer/slices/pr-monitor/pr-monitor-slice';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspaceId: string;
    agentId: string;
  }

  let { workspaceId, agentId }: Props = $props();

  // Writable stores mirror the props so the Redux selectors re-evaluate when
  // they change (selector readables are init-time only).
  const workspaceIdStore = writable('');
  const agentIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspaceId);
    agentIdStore.set(agentId);
  });

  const monitors$ = selectAgentPrMonitors(workspaceIdStore, agentIdStore);
  const workspace$ = selectWorkspaceById(workspaceIdStore);

  // Refcounted live subscription: the read middleware opens the
  // `prMonitor:*` events.subscribe on the first subscriber and disposes on
  // the last.
  $effect(() => {
    if (!workspaceId) return;
    const currentWorkspaceId = workspaceId;
    untrack(() => appStore.dispatch(prMonitorsSubscribeRequested(currentWorkspaceId)));
    return () => {
      appStore.dispatch(prMonitorsUnsubscribeRequested(currentWorkspaceId));
    };
  });

  // Only ACTIVE monitors get chips; completed rows live on the PR-list
  // surface, cancelled rows are excluded server-side.
  const activeMonitors = $derived($monitors$.filter((mon) => mon.state === 'active'));

  /** `<owner>/<repo>` of the workspace, or undefined when unknown. */
  const workspaceRepo = $derived(
    $workspace$?.repositoryOwner && $workspace$?.repositoryName
      ? `${$workspace$.repositoryOwner}/${$workspace$.repositoryName}`
      : undefined,
  );

  /** Chip label: "#42", prefixed "org/repo: " only for cross-repo PRs. */
  function chipLabel(monitor: PrMonitorRow): string {
    const number = `#${formatInteger(monitor.prNumber)}`;
    if (workspaceRepo && monitor.repo !== workspaceRepo) {
      return m.chat_monitoredPrs_crossRepoChip_label({ repo: monitor.repo, number });
    }
    return number;
  }

  function handleFlush(monitor: PrMonitorRow, close: () => void) {
    close();
    appStore.dispatch(flushPrMonitorRequested(monitor.workspaceId, monitor.monitorId));
  }

  function handleCancel(monitor: PrMonitorRow, close: () => void) {
    close();
    appStore.dispatch(cancelPrMonitorRequested(monitor.workspaceId, monitor.monitorId));
  }

  function handleOpenPr(monitor: PrMonitorRow, close: () => void) {
    close();
    const url =
      monitor.url ?? `https://github.com/${monitor.repo}/pull/${monitor.prNumber}`;
    void handleLink(url, {
      workspaceId: workspaceId as WorkspaceId,
      forceExternal: true,
    });
  }

  /** Compact checks summary from the last snapshot, e.g. "3/4 passing". */
  function checksSummary(monitor: PrMonitorRow): string | undefined {
    const checks = monitor.lastSnapshot?.checks;
    if (!checks || checks.total === 0) return undefined;
    if (checks.failed > 0) {
      return m.chat_monitoredPrs_hover_checksFailing_label({
        failed: formatInteger(checks.failed),
        total: formatInteger(checks.total),
      });
    }
    if (checks.pending > 0) {
      return m.chat_monitoredPrs_hover_checksPending_label({
        pending: formatInteger(checks.pending),
        total: formatInteger(checks.total),
      });
    }
    return m.chat_monitoredPrs_hover_checksPassing_label({
      passed: formatInteger(checks.passed),
      total: formatInteger(checks.total),
    });
  }

  /** Compact approvals summary, e.g. "APPROVED (1/1 required)". */
  function approvalsSummary(monitor: PrMonitorRow): string | undefined {
    const approvals = monitor.lastSnapshot?.approvals;
    if (!approvals) return undefined;
    if (approvals.needed != null) {
      return m.chat_monitoredPrs_hover_approvalsRequired_label({
        decision: approvals.decision,
        have: formatInteger(approvals.have),
        needed: formatInteger(approvals.needed),
      });
    }
    return m.chat_monitoredPrs_hover_approvals_label({
      decision: approvals.decision,
      have: formatInteger(approvals.have),
    });
  }

  /** Unresolved-threads summary; undefined when there are none. */
  function threadsSummary(monitor: PrMonitorRow): string | undefined {
    const threads = monitor.lastSnapshot?.threads;
    if (!threads || threads.unresolved === 0) return undefined;
    return threads.unresolved === 1
      ? m.chat_monitoredPrs_hover_threads_one()
      : m.chat_monitoredPrs_hover_threads_many({
          count: formatInteger(threads.unresolved),
        });
  }

  /** Mergeable / blocked line; prefers the explicit blocked reason. */
  function mergeSummary(monitor: PrMonitorRow): string | undefined {
    const snapshot = monitor.lastSnapshot;
    if (!snapshot) return undefined;
    if (snapshot.mergeBlockedReason) {
      return m.chat_monitoredPrs_hover_blocked_label({ reason: snapshot.mergeBlockedReason });
    }
    if (snapshot.mergeable === true) return m.chat_monitoredPrs_hover_mergeable_label();
    if (snapshot.mergeable === false) return m.chat_monitoredPrs_hover_notMergeable_label();
    return undefined;
  }
</script>

{#if activeMonitors.length > 0}
  <div
    class="flex flex-wrap items-center gap-1.5 px-2.5 py-1 opacity-70"
    role="group"
    aria-label={m.chat_monitoredPrs_row_ariaLabel()}
    data-testid="monitored-prs-row"
    transition:safeSlide={{ axis: 'y', duration: 200 }}
  >
    <Fa icon={faCodePullRequest} class="w-2.5 h-2.5 text-ghost shrink-0" />
    <span class="text-xs leading-tight text-ghost shrink-0"
      >{m.chat_monitoredPrs_monitoredPrs_label()}</span
    >
    {#each activeMonitors as monitor (monitor.monitorId)}
      <DropdownMenu side="top" align="start">
        {#snippet trigger({ toggle }: { toggle: () => void })}
          <Tooltip
            side="top"
            align="start"
            delayDuration={300}
            disableHoverableContent={false}
            contentClass="max-w-sm"
          >
            {#snippet content()}
              <div class="flex flex-col gap-1 text-xs" data-testid="monitored-pr-hover-card">
                <div class="flex items-center gap-1.5 font-medium">
                  <Fa icon={faCodePullRequest} class="w-2.5 h-2.5 text-ghost shrink-0" />
                  <span class="truncate"
                    >{monitor.title ??
                      m.chat_monitoredPrs_hover_untitled_label({
                        repo: monitor.repo,
                        number: formatInteger(monitor.prNumber),
                      })}</span
                  >
                  {#if monitor.lastSnapshot}
                    <span class="text-subtle font-normal">{monitor.lastSnapshot.state}</span>
                  {/if}
                </div>
                <div class="text-subtle">
                  <!-- i18n-ignore (org/repo#number identifier, not user-facing prose) -->
                  <span>{monitor.repo}#{monitor.prNumber}</span>
                  {#if checksSummary(monitor)}
                    <span class="mx-1" aria-hidden="true">·</span>
                    <span>{checksSummary(monitor)}</span>
                  {/if}
                  {#if approvalsSummary(monitor)}
                    <span class="mx-1" aria-hidden="true">·</span>
                    <span>{approvalsSummary(monitor)}</span>
                  {/if}
                  {#if threadsSummary(monitor)}
                    <span class="mx-1" aria-hidden="true">·</span>
                    <span>{threadsSummary(monitor)}</span>
                  {/if}
                </div>
                {#if mergeSummary(monitor)}
                  <div class="text-subtle">{mergeSummary(monitor)}</div>
                {/if}
                <div class="text-subtle">
                  {#if monitor.lastChangeAt}
                    <span
                      >{m.chat_monitoredPrs_hover_lastChange_label({
                        time: formatTime(monitor.lastChangeAt, { seconds: true }),
                      })}</span
                    >
                    <span class="mx-1" aria-hidden="true">·</span>
                  {/if}
                  {#if monitor.hasPendingChanges}
                    <span data-testid="monitored-pr-pending"
                      >{monitor.pendingChanges.length === 1
                        ? m.chat_monitoredPrs_hover_pending_one()
                        : m.chat_monitoredPrs_hover_pending_many({
                            count: formatInteger(monitor.pendingChanges.length),
                          })}</span
                    >
                  {:else}
                    <span>{m.chat_monitoredPrs_hover_noPending_label()}</span>
                  {/if}
                </div>
              </div>
            {/snippet}
            <button
              type="button"
              onclick={toggle}
              class="group/chip relative flex items-center gap-1 rounded border border-border/40 bg-muted/20 px-1.5 py-0.5 text-xs leading-tight text-subtle hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer"
              data-testid="monitored-pr-chip"
              data-monitor-state={monitor.state}
              data-pending={monitor.hasPendingChanges}
            >
              <span class="truncate max-w-40">{chipLabel(monitor)}</span>
              {#if monitor.hasPendingChanges}
                <span
                  class="block h-1.5 w-1.5 rounded-full bg-amber-500/80 shrink-0"
                  title={m.chat_monitoredPrs_pendingDot_tooltip()}
                ></span>
              {/if}
            </button>
          </Tooltip>
        {/snippet}

        {#snippet content({ close }: { close: () => void })}
          <div class="flex w-40 flex-col p-1">
            <Button
              variant="ghost-light"
              size="xs"
              class="justify-start"
              disabled={!monitor.hasPendingChanges}
              data-testid="monitored-pr-flush-item"
              onclick={() => handleFlush(monitor, close)}
            >
              <Fa icon={faPaperPlane} class="w-2.5 h-2.5" />
              {m.chat_monitoredPrs_flushNow_label()}
            </Button>
            <Button
              variant="ghost-light"
              size="xs"
              class="justify-start"
              data-testid="monitored-pr-open-item"
              onclick={() => handleOpenPr(monitor, close)}
            >
              <Fa icon={faArrowUpRightFromSquare} class="w-2.5 h-2.5" />
              {m.chat_monitoredPrs_openPr_label()}
            </Button>
            <Button
              variant="ghost-light"
              size="xs"
              class="justify-start"
              data-testid="monitored-pr-cancel-item"
              onclick={() => handleCancel(monitor, close)}
            >
              <Fa icon={faXmark} class="w-2.5 h-2.5" />
              {m.chat_monitoredPrs_cancel_label()}
            </Button>
          </div>
        {/snippet}
      </DropdownMenu>
    {/each}
  </div>
{/if}
