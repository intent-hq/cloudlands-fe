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
  import { Button } from '$lib/components/ui/button';
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
  class="type-body flex items-center gap-1.5 rounded-md {className}"
  data-testid="pr-monitor-wake-attribution"
>
  <Fa icon={faCodePullRequest} class="h-3 w-3 text-ghost" />
  <Button
    type="button"
    variant="plain"
    truncateLabel={false}
    wrapContent={false}
    class="type-body h-auto! min-w-0 cursor-pointer break-words p-0! text-left font-medium text-foreground hover:underline"
    data-testid="pr-monitor-wake-chip"
    title={m.chat_prMonitorWakeAttribution_openPr_tooltip()}
    onclick={handleOpenPr}
  >
    {chipLabel}
  </Button>
  <span class="font-normal text-muted-foreground"
    >{m.chat_prMonitorWakeAttribution_wokeAgent_after()}</span
  >
</div>
