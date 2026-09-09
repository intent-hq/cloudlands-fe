<script lang="ts">
  /**
   * MonitoredPrsRow Component
   *
   * Faint row above the chat input (rendered ABOVE the background-hooks row
   * when both exist) surfacing the active agent's monitored PRs (PROTOCOL
   * §6.9): one inline disclosure row per active monitor. The summary label
   * shows "<repo> #<number>: <title>", including the owner
   * ("<owner>/<repo> #<number>") when the PR's owner differs from the
   * workspace repository's owner or the workspace repository is unknown.
   * Expanding the row reveals last-refresh details (readiness,
   * checks/approvals/threads summary, last-change time, pending-emit
   * status); the kebab opens a 4-item action menu — check and flush
   * (`prMonitor.flush` with `check: true`, always enabled), open the PR in
   * the embedded browser panel, open it in the external browser, cancel
   * monitor (`prMonitor.cancel`).
   * Hidden entirely when the agent has no active monitors.
   *
   * All wire traffic lives in the `prMonitor` slice + its companion read
   * saga (`pr-monitor-saga`): this component only dispatches flush/cancel
   * triggers and renders from the selector.
   */

  import Fa from 'svelte-fa';
  import {
    faArrowUpRightFromSquare,
    faArrowsRotate,
    faChevronDown,
    faCodePullRequest,
    faWindowMaximize,
    faXmark,
  } from '@fortawesome/free-solid-svg-icons';
  import { safeSlide } from '$lib/utils/animations';
  import { writable } from 'svelte/store';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger, formatTime } from '$lib/i18n/format';
  import { getPrRepoLabel } from '$lib/utils/pr-chip-label';
  import { handleLink, openInBrowserPanel } from '$features/navigation/link-handler';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';
  import {
    selectAgentPrMonitors,
    selectPrMonitorsSnapshotStatus,
  } from '$store/renderer/slices/pr-monitor/pr-monitor-selectors';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import {
    cancelPrMonitorRequested,
    flushPrMonitorRequested,
  } from '$store/renderer/slices/pr-monitor/pr-monitor-slice';
  import { store as appStore } from '$store/renderer/store';
  import KebabIcon from '$lib/components/icons/KebabIcon.svelte';
  import {
    safeSubscriptionRowTransition,
    safeSubscriptionSlide,
    SUBSCRIPTION_ACTION_ICON_CLASS,
    SUBSCRIPTION_CHEVRON_CLASS,
    SUBSCRIPTION_CHEVRON_SIZE_CLASS,
    SUBSCRIPTION_ICON_CLASS,
    SUBSCRIPTION_ICON_BUTTON_CLASS,
    SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS,
    SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS,
  } from './subscription-disclosure';
  import { getExpandedPrMonitorId, setExpandedPrMonitorId } from './agent-subscriptions-view-state';

  interface Props {
    workspaceId: string;
    agentId: string;
    embedded?: boolean;
    visible?: boolean;
    count?: number;
  }

  let {
    workspaceId,
    agentId,
    embedded: _embedded = false,
    visible = $bindable(false),
    count = $bindable(0),
  }: Props = $props();
  let expandedMonitorId = $state<string | null>(null);
  let disclosureKey = $state('');

  $effect(() => {
    const nextKey = `${workspaceId}:${agentId}`;
    if (nextKey === disclosureKey) return;
    disclosureKey = nextKey;
    expandedMonitorId = getExpandedPrMonitorId(workspaceId, agentId);
  });

  function toggleMonitorDetails(monitorId: string) {
    expandedMonitorId = expandedMonitorId === monitorId ? null : monitorId;
    setExpandedPrMonitorId(workspaceId, agentId, expandedMonitorId);
  }

  // Writable stores mirror the props so the Redux selectors re-evaluate when
  // they change (selector readables are init-time only).
  const workspaceIdStore = writable('');
  const agentIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspaceId);
    agentIdStore.set(agentId);
  });

  const monitors$ = selectAgentPrMonitors(workspaceIdStore, agentIdStore);
  const snapshotStatus$ = selectPrMonitorsSnapshotStatus(workspaceIdStore);
  const workspace$ = selectWorkspaceById(workspaceIdStore);

  // Only ACTIVE monitors get chips; completed rows live on the PR-list
  // surface, cancelled rows are excluded server-side.
  const activeMonitors = $derived($monitors$.filter((mon) => mon.state === 'active'));

  $effect(() => {
    visible = activeMonitors.length > 0 || $snapshotStatus$ !== 'ready';
    count = activeMonitors.length;
  });

  /** `<owner>/<repo>` of the workspace, or undefined when unknown. */
  const workspaceRepo = $derived(
    $workspace$?.repositoryOwner && $workspace$?.repositoryName
      ? `${$workspace$.repositoryOwner}/${$workspace$.repositoryName}`
      : undefined,
  );

  function monitorTitle(monitor: PrMonitorRow): string {
    return (
      monitor.title ??
      m.chat_monitoredPrs_hover_untitled_label({
        repo: monitor.repo,
        number: String(monitor.prNumber),
      })
    );
  }

  /**
   * Summary label. The repo segment follows the shared PR-chip convention
   * (`getPrRepoLabel`): `repo` same-owner, `owner/repo` cross-owner/unknown.
   */
  function monitorLabel(monitor: PrMonitorRow): string {
    return m.chat_monitoredPrs_monitoring_label({
      repo: getPrRepoLabel(monitor.repo, workspaceRepo),
      number: String(monitor.prNumber),
      title: monitorTitle(monitor),
    });
  }

  function handleCheckAndFlush(monitor: PrMonitorRow, close: () => void) {
    close();
    appStore.dispatch(flushPrMonitorRequested(monitor.workspaceId, monitor.monitorId, true));
  }

  function handleCancel(monitor: PrMonitorRow, close: () => void) {
    close();
    appStore.dispatch(cancelPrMonitorRequested(monitor.workspaceId, monitor.monitorId));
  }

  /** PR URL, falling back to the canonical GitHub URL when `url` is absent. */
  function prUrl(monitor: PrMonitorRow): string {
    return monitor.url ?? `https://github.com/${monitor.repo}/pull/${monitor.prNumber}`;
  }

  function handleOpenInApp(monitor: PrMonitorRow, close: () => void) {
    close();
    // Built-in fallback to the external browser when the panel cannot open.
    void openInBrowserPanel(prUrl(monitor), workspaceId as WorkspaceId);
  }

  function handleOpenExternal(monitor: PrMonitorRow, close: () => void) {
    close();
    void handleLink(prUrl(monitor), {
      workspaceId: workspaceId as WorkspaceId,
      forceExternal: true,
    });
  }

  /** Only surface checks that still need attention; completed checks are implied by readiness. */
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
    return undefined;
  }

  /** Compact approvals summary, e.g. "APPROVED (1/1 required)". */
  function approvalsSummary(monitor: PrMonitorRow): string | undefined {
    const approvals = monitor.lastSnapshot?.approvals;
    if (!approvals || approvals.needed == null || approvals.have >= approvals.needed)
      return undefined;
    if (approvals.needed > 0) {
      return m.chat_monitoredPrs_hover_approvalsRequired_label({
        have: formatInteger(approvals.have),
        needed: formatInteger(approvals.needed),
      });
    }
    return undefined;
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

  function inferredBlocker(monitor: PrMonitorRow): string | undefined {
    const snapshot = monitor.lastSnapshot;
    if (!snapshot) return undefined;
    if (snapshot.hasConflicts) return m.chat_monitoredPrs_blocker_conflicts();
    if (snapshot.isBehind) return m.chat_monitoredPrs_blocker_behind();
    if ((snapshot.checks.failingRequired ?? 0) > 0 || snapshot.checks.failed > 0) {
      return m.chat_monitoredPrs_blocker_checksFailing();
    }
    if ((snapshot.checks.pendingRequired ?? 0) > 0) {
      return m.chat_monitoredPrs_blocker_checksPending();
    }
    if (snapshot.approvals.changesRequested > 0) {
      return m.chat_monitoredPrs_blocker_changesRequested();
    }
    if (snapshot.approvals.needed != null && snapshot.approvals.have < snapshot.approvals.needed) {
      return m.chat_monitoredPrs_blocker_approvals();
    }
    if (snapshot.threads.resolutionRequired && snapshot.threads.unresolved > 0) {
      return m.chat_monitoredPrs_blocker_threads();
    }
    if (snapshot.mergeable === false || snapshot.mergeBlockedReason) {
      return m.chat_monitoredPrs_blocker_requirements();
    }
    return undefined;
  }

  function readinessSummary(monitor: PrMonitorRow): string {
    const snapshot = monitor.lastSnapshot;
    if (snapshot?.isDraft) return m.chat_monitoredPrs_status_draft();
    if (snapshot?.state === 'open' && snapshot.isInMergeQueue) {
      return m.chat_monitoredPrs_status_mergeQueue();
    }
    const blocker = inferredBlocker(monitor);
    if (blocker) return m.chat_monitoredPrs_status_blocked({ reason: blocker });
    if (
      snapshot?.state === 'open' &&
      snapshot.mergeable === true &&
      snapshot.rulesKnown &&
      snapshot.checks.requiredKnown &&
      snapshot.approvals.needed != null
    ) {
      return m.chat_monitoredPrs_status_ready();
    }
    return m.chat_monitoredPrs_status_unknown();
  }
</script>

{#if activeMonitors.length === 0 && $snapshotStatus$ !== 'ready'}
  <div
    class="flex min-h-10 items-center gap-2 px-3 py-2 text-muted-foreground {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS}"
    data-testid="pr-monitors-snapshot-status"
    data-snapshot-status={$snapshotStatus$}
    role={$snapshotStatus$ === 'failed' ? 'alert' : 'status'}
  >
    {#if $snapshotStatus$ === 'loading'}
      <span
        class="size-3 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"
      ></span>
      <span>{m.chat_chatMessage_loading_label()}</span>
    {:else}
      <span>{m.chat_streamingStatus_responseFailed_label()}</span>
    {/if}
  </div>
{/if}

{#if activeMonitors.length > 0}
  <div
    class="w-full min-w-0 max-w-full"
    role="group"
    aria-label={m.chat_monitoredPrs_row_ariaLabel()}
    data-testid="monitored-prs-row"
    transition:safeSlide={{ axis: 'y', duration: 200 }}
  >
    {#each activeMonitors as monitor (monitor.monitorId)}
      {@const detailsId = `monitored-pr-details-${monitor.monitorId}`}
      <div
        class="overflow-hidden {SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS}"
        data-monitor-state={monitor.state}
        data-subscription-motion-row="pr-monitor"
        role="group"
        aria-label={monitorLabel(monitor)}
        transition:safeSubscriptionRowTransition
      >
        <div
          class="flex min-h-9 min-w-0 max-w-full items-center gap-2 px-3 py-2 text-muted-foreground"
        >
          <Button
            variant="plain"
            type="button"
            class="h-auto min-h-0 w-auto min-w-0 max-w-full flex-1 shrink overflow-hidden whitespace-normal rounded border-0 text-left {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS} focus-visible:ring-1"
            data-testid="monitored-pr-summary"
            data-subscription-row="pr-monitor"
            aria-expanded={expandedMonitorId === monitor.monitorId}
            aria-controls={detailsId}
            onclick={() => toggleMonitorDetails(monitor.monitorId)}
          >
            <Fa icon={faCodePullRequest} class="h-3.5 w-3.5 shrink-0 {SUBSCRIPTION_ICON_CLASS}" />
            <span class="min-w-0 flex-1 truncate">{monitorLabel(monitor)}</span>
            {#if monitor.hasPendingChanges}
              <span
                class="block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/80"
                title={m.chat_monitoredPrs_pendingDot_tooltip()}
              ></span>
            {/if}
          </Button>
          <DropdownMenu
            side="top"
            align="end"
            collisionPadding={12}
            contentClass="monitored-pr-menu-content p-0"
          >
            {#snippet trigger({ props })}
              <Button
                {...props}
                variant="plain"
                size="icon-xs"
                type="button"
                onclick={(event) => {
                  event.stopPropagation();
                  (props.onclick as ((event: MouseEvent) => void) | undefined)?.(event);
                }}
                class="h-6 w-6 border-0 {SUBSCRIPTION_ACTION_ICON_CLASS} {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:ring-1"
                data-testid="monitored-pr-chip"
                aria-label={m.chat_monitoredPrs_row_ariaLabel()}
              >
                <KebabIcon class="h-3 w-3" />
              </Button>
            {/snippet}
            {#snippet content({ close }: { close: () => void })}
              <div
                class="flex w-full min-w-0 flex-col p-1"
                data-testid="monitored-pr-menu"
                data-viewport-padding="12"
              >
                <Button
                  variant="ghost-light"
                  size="xs"
                  class="h-auto min-h-7 w-full min-w-0 items-start justify-start whitespace-normal py-1.5 text-left min-[284px]:whitespace-nowrap"
                  data-testid="monitored-pr-check-flush-item"
                  onclick={() => handleCheckAndFlush(monitor, close)}
                >
                  <Fa icon={faArrowsRotate} class="mt-0.5 h-2.5 w-2.5" />
                  <span class="min-w-0 break-words leading-4">
                    {m.chat_monitoredPrs_checkAndFlush_label()}
                  </span>
                </Button>
                <Button
                  variant="ghost-light"
                  size="xs"
                  class="h-auto min-h-7 w-full min-w-0 items-start justify-start whitespace-normal py-1.5 text-left min-[284px]:whitespace-nowrap"
                  data-testid="monitored-pr-open-in-app-item"
                  onclick={() => handleOpenInApp(monitor, close)}
                >
                  <Fa icon={faWindowMaximize} class="mt-0.5 h-2.5 w-2.5" />
                  <span class="min-w-0 break-words leading-4">
                    {m.chat_monitoredPrs_openInApp_label()}
                  </span>
                </Button>
                <Button
                  variant="ghost-light"
                  size="xs"
                  class="h-auto min-h-7 w-full min-w-0 items-start justify-start whitespace-normal py-1.5 text-left min-[284px]:whitespace-nowrap"
                  data-testid="monitored-pr-open-external-item"
                  onclick={() => handleOpenExternal(monitor, close)}
                >
                  <Fa icon={faArrowUpRightFromSquare} class="mt-0.5 h-2.5 w-2.5" />
                  <span class="min-w-0 break-words leading-4">
                    {m.chat_monitoredPrs_openInExternalBrowser_label()}
                  </span>
                </Button>
                <Button
                  variant="ghost-light"
                  size="xs"
                  class="h-auto min-h-7 w-full min-w-0 items-start justify-start whitespace-normal py-1.5 text-left min-[284px]:whitespace-nowrap"
                  data-testid="monitored-pr-cancel-item"
                  onclick={() => handleCancel(monitor, close)}
                >
                  <Fa icon={faXmark} class="mt-0.5 h-2.5 w-2.5" />
                  <span class="min-w-0 break-words leading-4">
                    {m.chat_monitoredPrs_cancel_label()}
                  </span>
                </Button>
              </div>
            {/snippet}
          </DropdownMenu>
          <Button
            variant="plain"
            size="icon-xs"
            type="button"
            class="h-6 w-6 border-0 {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:ring-1"
            data-testid="monitored-pr-disclosure"
            aria-label={monitorLabel(monitor)}
            aria-expanded={expandedMonitorId === monitor.monitorId}
            aria-controls={detailsId}
            onclick={(event) => {
              event.stopPropagation();
              toggleMonitorDetails(monitor.monitorId);
            }}
          >
            <span data-testid="monitored-pr-chevron">
              <Fa
                icon={faChevronDown}
                size={16}
                class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} {SUBSCRIPTION_CHEVRON_CLASS} {expandedMonitorId ===
                monitor.monitorId
                  ? ''
                  : 'rotate-90'}"
              />
            </span>
          </Button>
        </div>
        {#if expandedMonitorId === monitor.monitorId}
          <div
            id={detailsId}
            class="grid gap-1 overflow-hidden px-9 pb-2 text-xs text-subtle"
            data-testid="monitored-pr-details"
            transition:safeSubscriptionSlide
          >
            <strong class="font-medium text-muted-foreground">{readinessSummary(monitor)}</strong>
            {#if !workspaceRepo || monitor.repo !== workspaceRepo}
              <!-- i18n-ignore (org/repo#number identifier, not user-facing prose) -->
              <span>{monitor.repo}#{monitor.prNumber}</span>
            {/if}
            {#if checksSummary(monitor)}<span>{checksSummary(monitor)}</span>{/if}
            {#if approvalsSummary(monitor)}<span>{approvalsSummary(monitor)}</span>{/if}
            {#if threadsSummary(monitor)}<span>{threadsSummary(monitor)}</span>{/if}
            {#if monitor.lastChangeAt}
              <span
                >{m.chat_monitoredPrs_hover_lastChange_label({
                  time: formatTime(monitor.lastChangeAt, { seconds: true }),
                })}</span
              >
            {/if}
            {#if monitor.hasPendingChanges}
              <span data-testid="monitored-pr-pending"
                >{monitor.pendingChanges.length === 1
                  ? m.chat_monitoredPrs_hover_pending_one()
                  : m.chat_monitoredPrs_hover_pending_many({
                      count: formatInteger(monitor.pendingChanges.length),
                    })}</span
              >
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  :global(.monitored-pr-menu-content) {
    width: 260px;
    max-width: calc(100vw - 24px);
  }
</style>
