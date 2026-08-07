<script lang="ts">
  /**
   * NewWorkspaceCard - Hover card for creating a new workspace
   *
   * Shows WIP state if there's draft content, recent repos for quick access,
   * and a button to open the full creation modal.
   */
  import {
  faArrowRight,
  faFolder,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { goto } from '$app/navigation';
  import { m } from '$shared/paraglide/messages.js';
  import { invoke } from '$lib/electron-bridge';
  import { IPC_CHANNELS } from '$shared/ipc-registry';

  import { selectDraftPrompt } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import {
  closeAll,
  setShowCreateModal,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';

  import type { Workspace } from '$shared/types';
  import { WorkspaceStatusEnum } from '$shared/types';
  import { compareWorkspaceActivityDisplayTimeDesc } from '$shared/utils/workspace-activity-time';
  import Header from '$lib/components/ui/Header.svelte';
  import { store as appStore } from '$store/renderer/store';
  import { deriveRecentRepoEntries } from './recent-repos';

  const draftPrompt$ = selectDraftPrompt();
  const workspaceItems = selectWorkspaceItems();

  interface Props {
    expanded?: boolean;
  }


  let { expanded: _ = false }: Props = $props();

  const hasDraft = $derived($draftPrompt$.trim().length > 0);

  // Get recent repos from existing workspaces (deduplicated)
  const recentRepos = $derived.by(() =>
    deriveRecentRepoEntries(
      $workspaceItems
        .filter(
          (w: Workspace) =>
            w.status !== WorkspaceStatusEnum.Archived &&
            // w.status !== WorkspaceStatusEnum.Deleted &&
            w.repositoryName,
        )
        .sort(compareWorkspaceActivityDisplayTimeDesc),
    ),
  );

  function openModal(initialRepo?: { repoPath?: string; owner?: string; name?: string }, event?: MouseEvent) {
    appStore.dispatch(closeAll(false));
    if (initialRepo?.repoPath) {
      sessionStorage.setItem(
        'workspace-prefill',
        JSON.stringify({ repoPath: initialRepo.repoPath }),
      );
    }

    // Command-click (or Ctrl-click on non-Mac) opens in new window
    if (event?.metaKey || event?.ctrlKey) {
      invoke(IPC_CHANNELS.WINDOW.OPEN_NEW, { route: '/workspace/new' }).catch(() => {
        // Fallback to navigation in current window if IPC fails
        goto('/workspace/new');
      });
      return;
    }

    appStore.dispatch(setShowCreateModal(true));
  }

  function openWithDraft() {
    const currentDraft = selectDraftPrompt.select(appStore.state);
    if (currentDraft.trim()) {
      sessionStorage.setItem(
        'workspace-prefill',
        JSON.stringify({ prompt: currentDraft }),
      );
    }
    appStore.dispatch(closeAll(false));
    appStore.dispatch(setShowCreateModal(true));
  }

  function getGitHubAvatarUrl(owner: string, size: number = 24): string {
    return `https://github.com/${owner}.png?size=${size}`;
  }
</script>

<div class="px-3 pb-3 flex flex-col gap-2">
  <!-- WIP Draft -->
  {#if hasDraft}
    <button
      class="w-full text-left p-2.5 rounded-lg bg-primary/5 border border-primary/15 hover:bg-primary/10 transition-colors cursor-pointer group"
      onclick={openWithDraft}
    >
      <div class="flex items-center gap-2 mb-1">
        <span class="text-ui font-semibold uppercase tracking-wider text-primary/70">{m.layout_newWorkspaceCard_draft_label()}</span
        >
      </div>
      <p class="text-sm text-muted-foreground line-clamp-2">{$draftPrompt$.trim()}</p>
      <span
        class="text-ui text-muted-foreground mt-1 flex items-center gap-1 group-hover:text-foreground/60 transition-colors"
      >
        {m.layout_newWorkspaceCard_continueEditing_label()} <Fa icon={faArrowRight} size="xs" />
      </span>
    </button>
  {/if}

  <!-- Quick start with recent repos -->
  {#if recentRepos.length > 0}
    <Header size={6}>{m.layout_newWorkspaceCard_workOn_header()}</Header>
    <div>
      <div class="flex flex-col">
        {#each recentRepos as repo}
          <button
            class="flex items-center gap-2 px-1 py-1 rounded-md text-left hover:bg-sidebar cursor-pointer w-full focus:outline-0"
            onclick={(e) => openModal({ repoPath: repo.path, owner: repo.owner, name: repo.name }, e)}
          >
            {#if repo.owner}
              <img
                src={getGitHubAvatarUrl(repo.owner)}
                alt={repo.owner}
                class="size-4 rounded-full shrink-0"
                loading="lazy"
                onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
              />
            {:else}
              <span class="text-ghost shrink-0"><Fa icon={faFolder} size="xs" /></span
              >
            {/if}
            <span class="text-sm text-muted-foreground truncate font-medium flex-1">
              {#if repo.source === 'local'}
                {repo.folderName ?? repo.name ?? m.layout_newWorkspaceCard_unknownRepo_label()}
                {#if repo.owner && repo.name}
                  <span class="text-subtle ml-1">({repo.owner}/{repo.name})</span>
                {/if}
              {:else}
                {#if repo.owner}
                  <span class="text-subtle mr-1">{repo.owner} /</span>
                {/if}
                {repo.name ?? m.layout_newWorkspaceCard_unknownRepo_label()}
              {/if}
            </span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
