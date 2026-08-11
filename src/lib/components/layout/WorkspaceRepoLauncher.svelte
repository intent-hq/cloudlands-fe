<script lang="ts">
  import { faPlus } from '@fortawesome/free-solid-svg-icons';
  import RepoSelector, {
    type RepoChangeDetail,
  } from '$lib/components/workspace/initializer/RepoSelector.svelte';
  import { setShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import { setCompactWorkspaceInitializerFormState } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
  import { store as appStore } from '$store/renderer/store';

  function handleRepoChange(event: CustomEvent<RepoChangeDetail>) {
    const repo = event.detail;
    appStore.dispatch(
      setCompactWorkspaceInitializerFormState({
        repoPath: repo.path,
        repoType: repo.type,
        githubUrl: repo.githubUrl,
        clonePath: repo.clonePath,
        isNewRepo: repo.isNewRepo,
        isValidPath: repo.isValidPath,
        scope: repo.scope,
        scopeRepoPath: repo.scope ? repo.path : undefined,
        remoteSetup: repo.remoteSetup ?? null,
      }),
    );
    appStore.dispatch(setShowCreateModal(true));
  }
</script>

<div class="app-no-drag shrink-0" data-workspace-repo-launcher>
  <RepoSelector
    variant="ghost"
    value=""
    onchange={handleRepoChange}
    triggerClass="size-7 min-w-7 justify-center rounded-lg p-0! text-muted-foreground hover:bg-transparent hover:text-foreground"
    triggerContentClass="justify-center"
    emptyLabel=""
    triggerIcon={faPlus}
    triggerAriaLabel="New workspace from repository"
  />
</div>
