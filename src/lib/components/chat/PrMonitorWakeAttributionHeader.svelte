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
  import {
    selectActiveWorkspaceId,
    selectWorkspaceById,
  } from '$store/renderer/slices/workspace/workspace-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    attribution: PrMonitorWakeAttribution;
    /** Optional class name */
    class?: string;
  }

  let { attribution, class: className = '' }: Props = $props();

  // One-time reads: the workspace repo only shapes the chip label
  // (cross-repo prefix), so a live subscription is unnecessary.
  const workspaceId = selectActiveWorkspaceId.select(appStore.state);
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
    const wsId = selectActiveWorkspaceId.select(appStore.state);
    void handleLink(getPrMonitorWakeUrl(attribution), {
      workspaceId: (wsId ?? undefined) as WorkspaceId | undefined,
      forceExternal: true,
    });
  }
</script>

<div
  class="flex items-center gap-1.5 rounded-md text-xs {className}"
  data-testid="pr-monitor-wake-attribution"
>
  <Fa icon={faCodePullRequest} class="w-3 h-3 text-ghost" />
  <button
    type="button"
    class="text-foreground min-w-0 truncate font-medium hover:underline cursor-pointer"
    data-testid="pr-monitor-wake-chip"
    title={m.chat_prMonitorWakeAttribution_openPr_tooltip()}
    onclick={handleOpenPr}
  >
    {chipLabel}
  </button>
  <span class="text-subtle">{m.chat_prMonitorWakeAttribution_wokeAgent_after()}</span>
</div>
