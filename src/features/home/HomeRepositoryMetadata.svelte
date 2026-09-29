<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { store } from '$store/renderer/store';
  import { openHomeIntegrationUrl } from './home-integrations-slice';
  import { PullRequestStatus, type Workspace } from '$shared/types';
  import { getWorkspaceActivityDisplayTime } from '$shared/utils/workspace-activity-time';
  import { m } from '$shared/paraglide/messages.js';
  import { matchesHomeFilter } from './home-model';

  let {
    workspaces,
    repository,
  }: {
    workspaces: Workspace[];
    repository?: { owner?: string; name?: string; label: string; repoPath?: string };
  } = $props();

  const activeWorkspaces = $derived(
    workspaces.filter((workspace) => matchesHomeFilter(workspace, 'all')),
  );
  const running = $derived(
    activeWorkspaces.filter((workspace) => matchesHomeFilter(workspace, 'running')).length,
  );
  const linkedOpenPulls = $derived.by(() => {
    const urls = new Set<string>();
    for (const workspace of activeWorkspaces) {
      for (const pull of workspace.pullRequests ?? []) {
        if (
          pull.url &&
          (pull.status === PullRequestStatus.Open || pull.status === PullRequestStatus.Draft)
        ) {
          urls.add(pull.url.replace(/\/$/, '').toLowerCase());
        }
      }
      if (
        workspace.prUrl &&
        (workspace.prStatus === PullRequestStatus.Open ||
          workspace.prStatus === PullRequestStatus.Draft)
      ) {
        urls.add(workspace.prUrl.replace(/\/$/, '').toLowerCase());
      }
    }
    return urls.size;
  });
  const latestActivity = $derived(
    activeWorkspaces.reduce(
      (latest, workspace) => Math.max(latest, getWorkspaceActivityDisplayTime(workspace)),
      0,
    ),
  );
  const githubUrl = $derived(
    repository?.owner && repository.name
      ? `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`
      : null,
  );
</script>

<div
  class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 type-caption text-muted-foreground"
  data-home-repository-metadata
>
  <span
    >{m.home_repository_metadata_running()}
    <span class="font-medium text-foreground tabular-nums">{formatInteger(running)}</span></span
  >
  <span
    >{m.home_repository_metadata_linked_prs()}
    <span class="font-medium text-foreground tabular-nums">{formatInteger(linkedOpenPulls)}</span
    ></span
  >
  {#if latestActivity > 0}
    <span
      >{m.home_repository_metadata_activity()}
      <RelativeTime date={latestActivity} class="text-foreground" /></span
    >
  {/if}
  {#if githubUrl}
    <Button
      variant="link"
      size="sm"
      class="h-auto p-0"
      onclick={() => {
        if (githubUrl) store.dispatch(openHomeIntegrationUrl(githubUrl));
      }}>{m.home_repository_metadata_open_github()}</Button
    >
  {/if}
</div>
