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
  import { formatDateTime, formatInteger } from '$lib/i18n/format';
  import { getPrRepoLabel } from '$lib/utils/pr-chip-label';
  import { handleLink, openInBrowserPanel } from '$features/navigation/link-handler';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';
  import { selectAgentPrMonitors } from '$store/renderer/slices/pr-monitor/pr-monitor-selectors';
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
    SUBSCRIPTION_CHEVRON_CLASS,
    SUBSCRIPTION_CHEVRON_SIZE_CLASS,
    SUBSCRIPTION_ICON_CLASS,
    SUBSCRIPTION_ICON_BUTTON_CLASS,
    SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS,
    SUBSCRIPTION_LEADING_COLUMN_CLASS,
    SUBSCRIPTION_LEADING_CONTENT_CLASS,
    SUBSCRIPTION_ROW_GEOMETRY_CLASS,
    SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS,
    SUBSCRIPTION_TRAILING_CONTROLS_CLASS,
    SUBSCRIPTION_WAKE_BODY_PADDING_CLASS,
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
  const workspace$ = selectWorkspaceById(workspaceIdStore);

  // Only ACTIVE monitors get chips; completed rows live on the PR-list
  // surface, cancelled rows are excluded server-side.
  const activeMonitors = $derived($monitors$.filter((mon) => mon.state === 'active'));

  $effect(() => {
    visible = activeMonitors.length > 0;
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
          class="{SUBSCRIPTION_ROW_GEOMETRY_CLASS} {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS}"
          data-testid="monitored-pr-summary-row"
        >
          <Button
            variant="plain"
            type="button"
            class="h-auto min-h-0 w-auto min-w-0 max-w-full flex-1 shrink justify-start overflow-hidden whitespace-nowrap rounded border-0 p-0! text-left {SUBSCRIPTION_LEADING_CONTENT_CLASS} {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS} {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:ring-1"
            data-testid="monitored-pr-summary"
            data-subscription-row="pr-monitor"
            aria-expanded={expandedMonitorId === monitor.monitorId}
            aria-controls={detailsId}
            onclick={() => toggleMonitorDetails(monitor.monitorId)}
          >
            <span
              class="{SUBSCRIPTION_LEADING_COLUMN_CLASS} {SUBSCRIPTION_ICON_CLASS}"
              data-testid="monitored-pr-icon"
              aria-hidden="true"
            >
              <Fa icon={faCodePullRequest} size={14} class="h-3.5 w-3.5 shrink-0" />
            </span>
            <span
              class="min-w-0 flex-1 truncate text-muted-foreground"
              data-testid="monitored-pr-label">{monitorLabel(monitor)}</span
            >
          </Button>
          <div
            class={SUBSCRIPTION_TRAILING_CONTROLS_CLASS}
            data-testid="monitored-pr-trailing-controls"
          >
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
                  class="h-6 w-6 shrink-0 border-0 {SUBSCRIPTION_ICON_CLASS} {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:ring-1"
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
              class="h-6 w-6 shrink-0 border-0 {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:ring-1"
              data-testid="monitored-pr-disclosure"
              aria-label={monitorLabel(monitor)}
              aria-expanded={expandedMonitorId === monitor.monitorId}
              aria-controls={detailsId}
              onclick={(event) => {
                event.stopPropagation();
                toggleMonitorDetails(monitor.monitorId);
              }}
            >
              <span
                class="inline-flex h-6 w-6 shrink-0 items-center justify-center"
                data-testid="monitored-pr-chevron"
              >
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
        </div>
        {#if expandedMonitorId === monitor.monitorId}
          <div
            id={detailsId}
            class="grid gap-1 overflow-hidden text-xs text-muted-foreground {SUBSCRIPTION_WAKE_BODY_PADDING_CLASS}"
            data-testid="monitored-pr-details"
            transition:safeSubscriptionSlide
          >
            <span class="text-muted-foreground">{readinessSummary(monitor)}</span>
            {#if !workspaceRepo || monitor.repo !== workspaceRepo}
              <!-- i18n-ignore (org/repo#number identifier, not user-facing prose) -->
              <span class="text-muted-foreground">{monitor.repo}#{monitor.prNumber}</span>
            {/if}
            {#if checksSummary(monitor)}
              <span class="text-muted-foreground">{checksSummary(monitor)}</span>
            {/if}
            {#if approvalsSummary(monitor)}
              <span class="text-muted-foreground">{approvalsSummary(monitor)}</span>
            {/if}
            {#if threadsSummary(monitor)}
              <span class="text-muted-foreground">{threadsSummary(monitor)}</span>
            {/if}
            {#if monitor.lastChangeAt}
              <span class="text-muted-foreground">
                {m.chat_monitoredPrs_details_lastChangeAt({
                  time: formatDateTime(monitor.lastChangeAt),
                })}
              </span>
            {/if}
            {#if monitor.hasPendingChanges}
              <span class="text-muted-foreground" data-testid="monitored-pr-pending">
                {monitor.pendingChanges.length === 1
                  ? m.chat_monitoredPrs_hover_pending_one()
                  : m.chat_monitoredPrs_hover_pending_many({
                      count: formatInteger(monitor.pendingChanges.length),
                    })}
              </span>
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
