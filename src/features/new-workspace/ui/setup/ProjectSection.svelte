<script lang="ts">
  import Fa from 'svelte-fa';
  import { faFolderOpen, faFolderPlus, faGithub, faLink } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { DraftSource } from '$shared/types/workspace-draft';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import { selectWorkspaceCreationRecentRepos } from '$store/renderer/slices/workspace-creation-settings/workspace-creation-settings-selectors';
  import {
    getRecentRepoLabel,
    getRecentRepoTooltip,
  } from '$lib/components/workspace/initializer/recent-repo-display';
  import type { SourcePickerMode } from '../SourceCard.svelte';
  import {
    getProjectSectionVisibility,
    projectDescription,
    projectIsolation,
    projectName,
    sourceFromRecentRepo,
  } from './project-section';

  interface Props {
    source?: DraftSource | null;
    disabled?: boolean;
    onOpenPicker?: (mode: SourcePickerMode) => void;
    onSelectSource?: (source: DraftSource) => void;
  }

  let { source = null, disabled = false, onOpenPicker, onSelectSource }: Props = $props();
  const recentRepos$ = selectWorkspaceCreationRecentRepos();
  const githubConnected$ = selectGitHubAuthIsAuthenticated();
  const recentChoices = $derived(
    $recentRepos$
      .map((repo) => ({ repo, source: sourceFromRecentRepo(repo) }))
      .filter((choice): choice is typeof choice & { source: DraftSource } => choice.source !== null)
      .slice(0, 3),
  );
  const visibility = $derived(getProjectSectionVisibility(recentChoices.length, $githubConnected$));
  const changePickerMode = $derived<SourcePickerMode>(
    source?.kind === 'local' ? 'local' : source?.kind === 'newFolder' ? 'new-folder' : 'github',
  );
</script>

<section class="space-y-3" aria-labelledby="project-section-heading">
  <h3 id="project-section-heading" class="type-small font-medium">
    {m.newWorkspace_setup_project_title()}
  </h3>

  {#if source}
    <div class="selected-project" data-testid="selected-project">
      <span class="min-w-0 flex-1">
        <strong class="type-caption block truncate text-foreground">{projectName(source)}</strong>
        <small class="type-caption block truncate text-muted-foreground"
          >{projectDescription(source)}</small
        >
        {#if projectIsolation(source) === 'worktree'}
          <small class="type-caption block text-muted-foreground">
            {m.workspace_checkoutModePill_worktree_label()}
          </small>
        {:else if projectIsolation(source) === 'in-place'}
          <small class="type-caption block text-muted-foreground">
            {m.newWorkspace_source_inPlace_label()}
          </small>
        {/if}
      </span>
      <button
        type="button"
        class="change-project"
        {disabled}
        onclick={() => onOpenPicker?.(changePickerMode)}
      >
        {m.newWorkspace_setup_changeProject_label()}
      </button>
    </div>
  {:else}
    {#if visibility.recent}
      <div class="space-y-2">
        <p class="type-caption text-muted-foreground">{m.newWorkspace_setup_recent_title()}</p>
        <div class="grid gap-2 sm:grid-cols-2">
          {#each recentChoices as { repo, source } (repo.path)}
            {@const label = getRecentRepoLabel(repo)}
            <button
              type="button"
              class="project-choice"
              title={getRecentRepoTooltip(repo)}
              {disabled}
              onclick={() => onSelectSource?.(source)}
            >
              <span class="truncate font-medium text-foreground">
                {label.ownerPrefix ? `${label.ownerPrefix}/` : ''}{label.primary}
              </span>
              <span class="truncate text-muted-foreground">{label.suffix ?? repo.path}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <div class="grid gap-2 sm:grid-cols-2">
      {#if visibility.githubRepos}
        <button
          class="project-action"
          type="button"
          {disabled}
          onclick={() => onOpenPicker?.('github')}
        >
          <Fa icon={faGithub} class="size-4 shrink-0" />
          <span>
            <strong>{m.newWorkspace_setup_githubRepos_label()}</strong>
            <small>{m.newWorkspace_setup_githubRepos_description()}</small>
          </span>
        </button>
      {/if}
      <button
        class="project-action"
        type="button"
        {disabled}
        onclick={() => onOpenPicker?.('local')}
      >
        <Fa icon={faFolderOpen} class="size-4 shrink-0" />
        <span>
          <strong>{m.newWorkspace_setup_openFolder_label()}</strong>
          <small>{m.newWorkspace_setup_openFolder_description()}</small>
        </span>
      </button>
      <button
        class="project-action"
        type="button"
        {disabled}
        onclick={() => onOpenPicker?.('github')}
      >
        <Fa icon={faLink} class="size-4 shrink-0" />
        <span>
          <strong>{m.newWorkspace_setup_pasteUrl_label()}</strong>
          <small>{m.newWorkspace_setup_pasteUrl_description()}</small>
        </span>
      </button>
      <button
        class="project-action"
        type="button"
        {disabled}
        onclick={() => onOpenPicker?.('new-folder')}
      >
        <Fa icon={faFolderPlus} class="size-4 shrink-0" />
        <span>
          <strong>{m.newWorkspace_setup_newProject_label()}</strong>
          <small>{m.newWorkspace_setup_newProject_description()}</small>
        </span>
      </button>
    </div>
  {/if}
</section>

<style>
  .project-choice,
  .project-action,
  .selected-project {
    display: flex;
    min-width: 0;
    align-items: flex-start;
    gap: 0.625rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 0.625rem 0.75rem;
    text-align: left;
  }

  .selected-project {
    align-items: center;
  }

  .change-project {
    flex: none;
    border-radius: var(--radius-md);
    padding: 0.375rem 0.625rem;
    color: var(--foreground);
    font-size: 0.75rem;
    font-weight: 500;
  }

  .change-project:hover:not(:disabled) {
    background: var(--muted);
  }

  .project-choice {
    flex-direction: column;
    gap: 0.125rem;
    font-size: 0.75rem;
  }

  .project-action strong,
  .project-action small {
    display: block;
  }

  .project-action strong {
    color: var(--foreground);
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .project-action small {
    margin-top: 0.125rem;
    color: var(--muted-foreground);
    font-size: 0.75rem;
  }

  .project-choice:hover:not(:disabled),
  .project-action:hover:not(:disabled) {
    background: var(--muted);
  }

  .project-choice:focus-visible,
  .project-action:focus-visible,
  .change-project:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }

  .project-choice:disabled,
  .project-action:disabled,
  .change-project:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
</style>
