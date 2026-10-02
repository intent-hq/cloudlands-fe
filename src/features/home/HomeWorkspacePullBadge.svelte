<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faCircleCheck,
    faCircleExclamation,
    faCircleXmark,
    faClock,
  } from '@fortawesome/free-solid-svg-icons';
  import { buildWorkspacePRPresentationModel } from '$lib/components/workspace/sidebar/workspace-pr-presentation';
  import { PullRequestStatus, type Workspace } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';

  let { workspace }: { workspace: Workspace } = $props();
  const pull = $derived(workspace.pullRequests?.[0] ?? workspace.activePullRequest);
  const lifecycle = $derived(
    pull
      ? buildWorkspacePRPresentationModel({
          workspacePRs: [
            { ...pull, isDraft: pull.status === PullRequestStatus.Open && pull.isDraft },
          ],
          activePR: null,
          monitors: [],
          workspaceRepo: undefined,
          buildPrUrl: (_number, url) => url ?? '',
          getDisplayTitle: (pr) => pr.title,
        })[0]
      : undefined,
  );
  const appearance = $derived.by(() => {
    if (!pull || !lifecycle) return null;
    const base = {
      label: lifecycle.accessibleStateLabel,
      icon: lifecycle.statusIcon,
      color: lifecycle.foregroundClass,
      background: lifecycle.backgroundClass,
    };
    // Enrichment is optional. Missing values retain the explicit lifecycle state.
    if (pull.status !== PullRequestStatus.Open || pull.isDraft) return base;
    if (pull.mergeConflicts === true || pull.mergeableState === 'dirty')
      return {
        ...base,
        label: m.home_pr_badge_conflict(),
        icon: faCircleExclamation,
        color: 'text-danger',
        background: 'bg-danger-background/10',
      };
    if ((pull.ciStatus?.failed ?? 0) > 0)
      return {
        ...base,
        label: m.home_pr_badge_ci_failed(),
        icon: faCircleXmark,
        color: 'text-danger',
        background: 'bg-danger-background/10',
      };
    if (pull.reviewDecision === 'CHANGES_REQUESTED')
      return {
        ...base,
        label: m.home_integrations_review_changes_requested(),
        icon: faCircleExclamation,
        color: 'text-danger',
        background: 'bg-danger-background/10',
      };
    if ((pull.ciStatus?.pending ?? 0) > 0)
      return {
        ...base,
        label: m.home_pr_badge_ci_running(),
        icon: faClock,
        color: 'text-muted-foreground',
        background: 'bg-muted',
      };
    if (pull.isInMergeQueue === true)
      return { ...base, label: m.workspace_prSection_statusQueued_label(), icon: faClock };
    if (pull.reviewDecision === 'REVIEW_REQUIRED')
      return {
        ...base,
        label: m.home_pr_badge_review_required(),
        icon: faClock,
        color: 'text-muted-foreground',
        background: 'bg-muted',
      };
    if (pull.reviewDecision === 'APPROVED')
      return { ...base, label: m.home_integrations_review_approved(), icon: faCircleCheck };
    return base;
  });
</script>

{#if pull && appearance}
  <span
    class="inline-flex min-w-0 max-w-full shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs {appearance.background} {appearance.color}"
    title={`${appearance.label} · #${pull.number} · ${pull.title}`}
    data-home-workspace-pr-badge
  >
    <Fa icon={appearance.icon} class="shrink-0" />
    <span class="truncate">{appearance.label}</span>
    <span class="shrink-0 tabular-nums">#{pull.number}</span>
  </span>
{/if}
