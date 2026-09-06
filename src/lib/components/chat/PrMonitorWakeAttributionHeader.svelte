<script lang="ts">
  /**
   * PrMonitorWakeAttributionHeader
   *
   * Compact attribution header for centralized PR-monitor wake messages
   * (`messageMetadata.type === 'pr_monitor_wake'`, PROTOCOL §5.42):
   * pull-request icon + clickable PR chip + "woke the agent". Mirrors the
   * HookWakeAttributionHeader layout, but the chip is a button that opens
   * the PR in the external browser (metadata `url` first, GitHub fallback).
   */
  import Fa from 'svelte-fa';
  import { faCodePullRequest } from '@fortawesome/free-solid-svg-icons';
  import type { WorkspaceId } from '$shared/types/branded-ids';
  import {
    type PrMonitorWakeAttribution,
    getPrMonitorWakeChipLabel,
    getPrMonitorWakeUrl,
  } from '$lib/utils/pr-monitor-wake-attribution';
  import { handleLink } from '$features/navigation/link-handler';
  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import { getWorkspaceRouteContext } from '$lib/utils/workspace-route-context';
  import {
    SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
    SUBSCRIPTION_ICON_CLASS,
    SUBSCRIPTION_LEADING_COLUMN_CLASS,
  } from './subscription-disclosure';

  interface Props {
    attribution: PrMonitorWakeAttribution;
    /** Optional class name */
    class?: string;
  }

  let { attribution, class: className = '' }: Props = $props();

  // One-time reads: the workspace repo only shapes the chip label
  // (cross-repo prefix), so a live subscription is unnecessary.
  const workspaceId = getWorkspaceRouteContext()?.workspaceId ?? undefined;
  const workspace = workspaceId
    ? selectWorkspaceById.select(appStore.state, workspaceId)
    : undefined;
  const workspaceRepo =
    workspace?.repositoryOwner && workspace?.repositoryName
      ? `${workspace.repositoryOwner}/${workspace.repositoryName}`
      : undefined;

  const chipLabel = $derived(getPrMonitorWakeChipLabel(attribution, workspaceRepo));

  function handleOpenPr(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    void handleLink(getPrMonitorWakeUrl(attribution), {
      workspaceId: workspaceId as WorkspaceId | undefined,
      forceExternal: true,
    });
  }
</script>

<div
  class="{SUBSCRIPTION_DISCLOSURE_ROW_CLASS} rounded-md {className}"
  data-testid="pr-monitor-wake-attribution"
>
  <span class={SUBSCRIPTION_LEADING_COLUMN_CLASS} aria-hidden="true">
    <Fa
      icon={faCodePullRequest}
      size={14}
      class="h-3.5! w-3.5! shrink-0 {SUBSCRIPTION_ICON_CLASS}"
    />
  </span>
  <span
    class="grid min-w-0 flex-1 grid-cols-[minmax(4rem,max-content)_minmax(0,1fr)] items-baseline gap-1 overflow-hidden whitespace-nowrap"
  >
    <button
      type="button"
      class="min-w-0 max-w-full cursor-pointer truncate border-none bg-transparent p-0 text-left font-normal text-muted-foreground hover:underline"
      data-testid="pr-monitor-wake-chip"
      title={m.chat_prMonitorWakeAttribution_openPr_tooltip()}
      onclick={handleOpenPr}
    >
      {chipLabel}
    </button>
    <span
      class="min-w-0 truncate whitespace-nowrap font-normal text-muted-foreground"
      data-testid="pr-monitor-wake-status">{m.chat_prMonitorWakeAttribution_wokeAgent_after()}</span
    >
  </span>
</div>
