<script lang="ts">
  /**
   * NewWorkspaceCard - Hover card for creating a new workspace
   *
   * Shows WIP state if there's draft content, recent repos for quick access,
   * and a button to open the full creation modal.
   */
  import { faPlus, faArrowRight, faCodeBranch, faFolder } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { sidebarNavStore } from '../sidebar-nav.store.svelte';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import type { Workspace } from '$shared/types';
  import { WorkspaceStatusEnum } from '$shared/types';

  interface Props {
    expanded?: boolean;
  }

  let { expanded: _ = false }: Props = $props();

  const hasDraft = $derived(sidebarNavStore.draftPrompt.trim().length > 0);

  // Get recent repos from existing workspaces (deduplicated)
  const recentRepos = $derived.by(() => {
    const repoMap = new Map<
      string,
      { name: string; owner?: string; path: string; branch: string }
    >();
    const workspaces = workspaceStore.items
      .filter(
        (w: Workspace) =>
          w.status !== WorkspaceStatusEnum.Archived &&
          // w.status !== WorkspaceStatusEnum.Deleted &&
          w.repositoryName,
      )
      .sort(
        (a: Workspace, b: Workspace) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );

    for (const ws of workspaces) {
      if (!ws.repositoryPath || repoMap.has(ws.repositoryPath)) continue;
      repoMap.set(ws.repositoryPath, {
        name: ws.repositoryName || ws.repositoryPath.split('/').pop() || 'Unknown',
        owner: ws.repositoryOwner,
        path: ws.repositoryPath,
        branch: ws.branch || 'main',
      });
      if (repoMap.size >= 4) break;
    }
    return [...repoMap.values()];
  });

  function openModal(initialRepo?: { repoPath?: string; owner?: string; name?: string }) {
    sidebarNavStore.closeAll();
    window.dispatchEvent(
      new CustomEvent('app:open-new-space-modal', {
        detail: initialRepo ? { initialRepo } : {},
      }),
    );
  }

  function openWithDraft() {
    if (sidebarNavStore.draftPrompt.trim()) {
      sessionStorage.setItem(
        'workspace-prefill',
        JSON.stringify({ prompt: sidebarNavStore.draftPrompt }),
      );
    }
    sidebarNavStore.closeAll();
    window.dispatchEvent(new CustomEvent('app:open-new-space-modal', { detail: {} }));
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
        <span class="text-[10px] font-semibold uppercase tracking-wider text-primary/70">Draft</span
        >
      </div>
      <p class="text-sm text-foreground/80 line-clamp-2">{sidebarNavStore.draftPrompt.trim()}</p>
      <span
        class="text-[11px] text-muted-foreground/50 mt-1 flex items-center gap-1 group-hover:text-foreground/60 transition-colors"
      >
        Continue editing <Fa icon={faArrowRight} size="xs" />
      </span>
    </button>
  {/if}

  <!-- Quick start with recent repos -->
  {#if recentRepos.length > 0}
    <div>
      <!-- <span
        class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-0.5"
        >Recent repos</span
      > -->
      <div class="flex flex-col">
        {#each recentRepos as repo}
          <button
            class="flex items-center gap-2 px-1 py-1 rounded-md text-left hover:bg-sidebar cursor-pointer w-full"
            onclick={() => openModal({ repoPath: repo.path, owner: repo.owner, name: repo.name })}
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
              <span class="text-muted-foreground/40 shrink-0"><Fa icon={faFolder} size="xs" /></span
              >
            {/if}
            <span class="text-sm text-foreground/80 truncate font-medium flex-1">{repo.name}</span>
            <!-- <span class="text-[11px] text-muted-foreground/40 flex items-center gap-0.5 shrink-0">
              <Fa icon={faCodeBranch} class="text-[9px]" />{repo.branch}
            </span> -->
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- New space button -->
  <button
    class="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-muted/30 hover:bg-muted/50 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
    onclick={() => openModal()}
  >
    <Fa icon={faPlus} size="xs" />
    Create in another project
  </button>
</div>
