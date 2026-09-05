<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faFolder,
    faGlobe,
    faLink,
    faLock,
    faTriangleExclamation,
    faGithub,
  } from '$lib/icons/phosphor-icons';
  import { Button } from '$lib/components/ui/button';
  import Input from '$lib/components/ui/input/input.svelte';
  import RepoSelector, {
    type RepoChangeDetail,
  } from '$lib/components/workspace/initializer/RepoSelector.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { DraftSource } from '$shared/types/workspace-draft';
  import { getNewFolderNameError, type NewFolderNameError, type SourcePresentation } from './types';

  interface Props {
    source: DraftSource | null;
    presentation?: SourcePresentation;
    disabled?: boolean;
    onChooseNewFolder?: (name: string) => void;
    onSourceSelected?: (source: DraftSource) => void;
  }

  let {
    source,
    presentation = {},
    disabled = false,
    onChooseNewFolder,
    onSourceSelected,
  }: Props = $props();

  // i18n-ignore (default filesystem-safe directory name)
  let newFolderName = $state('my-project');
  const newFolderNameError = $derived(getNewFolderNameError(newFolderName));
  const activeNewFolderError = $derived(
    source?.kind === 'newFolder' ? getNewFolderNameError(source.name) : newFolderNameError,
  );

  const sourceState = $derived.by(() => {
    if (presentation.unresolvedLink) return 'unresolved-link';
    if (!source && activeNewFolderError) return 'new-folder-invalid';
    if (!source) return 'none';
    if (source.kind === 'local') return presentation.localKind === 'non-git' ? 'non-git' : 'local';
    if (source.kind === 'newFolder')
      return activeNewFolderError ? 'new-folder-invalid' : 'new-folder';
    if (presentation.githubAccess === 'no-access') return 'github-no-access';
    return presentation.githubAccess === 'private' ? 'github-private' : 'github-public';
  });

  const title = $derived.by(() => {
    switch (sourceState) {
      case 'none':
        return m.newWorkspace_source_none_title();
      case 'new-folder-invalid':
        return m.newWorkspace_source_newProject_title();
      case 'unresolved-link':
        return m.newWorkspace_source_unresolved_title();
      case 'local':
        return m.workspace_hoverCard_localRepository_label();
      case 'non-git':
        return m.workspace_repoSelector_folderNotGitRepo_label();
      case 'new-folder':
        return m.workspaceCreation_dirPicker_newFolder_label();
      case 'github-public':
        return m.newWorkspace_source_publicGithub_title();
      case 'github-private':
        return m.newWorkspace_source_privateGithub_title();
      case 'github-no-access':
        return m.workspace_branchSelector_noAccess_error();
    }
  });

  const summary = $derived.by(() => {
    if (presentation.unresolvedLink) return presentation.unresolvedLink;
    if (!source) return m.workspaceCreation_selectRepoHint_label();
    if (source.kind === 'local') return source.path;
    if (source.kind === 'newFolder') return `${source.parentPath}/${source.name}`;
    return `${source.owner}/${source.name}`;
  });

  function errorLabel(error: NewFolderNameError): string {
    switch (error) {
      case 'required':
        return m.workspaceValidation_projectNameRequired_error();
      case 'path-separator':
        return m.workspaceCreation_projectPicker_pathSeparators_error();
      case 'dot-name':
        return m.workspaceCreation_projectPicker_dotName_error();
      case 'null-character':
        return m.workspaceCreation_projectPicker_nullChars_error();
      case 'invalid-character':
        return m.workspaceCreation_projectPicker_invalidChars_error();
      case 'too-long':
        return m.workspaceCreation_projectPicker_nameTooLong_error();
    }
  }

  function chooseNewFolder(): void {
    if (!newFolderNameError) onChooseNewFolder?.(newFolderName.trim());
  }

  function selectRepo(event: CustomEvent<RepoChangeDetail>): void {
    const selection = event.detail;
    if (selection.type === 'github') {
      const url = selection.githubUrl || selection.path;
      const match = url.match(/github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?$/);
      if (!match) return;
      onSourceSelected?.({ kind: 'github', url, owner: match[1], name: match[2] });
      return;
    }
    if (selection.type === 'local' && selection.path) {
      onSourceSelected?.({ kind: 'local', path: selection.path, isolation: 'worktree' });
    }
  }
</script>

<section class="rounded-xl border border-border bg-card p-4" data-source-state={sourceState}>
  <div class="flex items-start gap-3">
    <div class="mt-0.5 text-muted-foreground">
      {#if sourceState === 'new-folder-invalid'}
        <Fa icon={faTriangleExclamation} class="text-danger" />
      {:else if sourceState === 'unresolved-link'}
        <Fa icon={faLink} />
      {:else if sourceState === 'github-public'}
        <Fa icon={faGlobe} />
      {:else if sourceState === 'github-private'}
        <Fa icon={faLock} />
      {:else if sourceState === 'github-no-access'}
        <Fa icon={faTriangleExclamation} />
      {:else if source?.kind === 'github'}
        <Fa icon={faGithub} />
      {:else}
        <Fa icon={faFolder} />
      {/if}
    </div>
    <div class="min-w-0 flex-1">
      <h2 class="text-sm font-semibold">{title}</h2>
      <p class="mt-1 break-all text-xs text-muted-foreground">{summary}</p>
      {#if sourceState === 'new-folder-invalid' && activeNewFolderError}
        <p class="mt-2 text-xs text-danger" role="alert">{errorLabel(activeNewFolderError)}</p>
      {:else if sourceState === 'unresolved-link'}
        <p class="mt-2 text-xs text-muted-foreground">
          {m.newWorkspace_source_unresolved_description()}
        </p>
      {:else if sourceState === 'non-git'}
        <p class="mt-2 text-xs text-muted-foreground">
          {m.workspace_validation_nonGitInit_warning()}
        </p>
      {/if}
    </div>
  </div>

  {#if source?.kind === 'local' || source?.kind === 'github'}
    <details class="mt-3 text-xs">
      <summary class="cursor-pointer font-medium text-muted-foreground">
        {m.settings_aiBehavior_advanced_label()}
      </summary>
      <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
        <dt>{m.ui_openCombo_copyBranch_shortLabel()}</dt>
        <dd class="truncate text-foreground">
          {source.branch ?? m.chat_modelPicker_providerDefault_label()}
        </dd>
        {#if source.kind === 'local'}
          <dt>{m.newWorkspace_source_isolation_label()}</dt>
          <dd class="text-foreground">
            {source.isolation === 'worktree'
              ? m.workspace_isolationMode_worktree_label()
              : m.newWorkspace_source_inPlace_label()}
          </dd>
        {/if}
      </dl>
    </details>
  {/if}

  {#if sourceState === 'none' || sourceState === 'new-folder-invalid' || sourceState === 'unresolved-link' || sourceState === 'github-no-access'}
    <div class="mt-4 border-b border-border pb-4">
      <RepoSelector
        value=""
        onchange={selectRepo}
        triggerClass="w-full justify-start"
        emptyLabel={m.workspace_repoSelector_selectRepository_label()}
        showEmptyIcon
        showTriggerChevron
      />
    </div>
    <div class="mt-4 rounded-lg border border-border bg-background p-3">
      <h3 class="text-sm font-semibold">{m.newWorkspace_source_newProject_title()}</h3>
      <p class="mt-1 text-xs text-muted-foreground">
        {m.newWorkspace_source_newProject_description()}
      </p>
      <div class="mt-3 flex gap-2">
        <Input
          value={newFolderName}
          oninput={(event) => (newFolderName = event.currentTarget.value)}
          placeholder={m.workspaceCreation_newProjectTab_projectName_placeholder()}
          aria-label={m.workspaceCreation_newProjectTab_projectName_placeholder()}
          aria-invalid={newFolderNameError ? 'true' : undefined}
          {disabled}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || Boolean(newFolderNameError)}
          onclick={chooseNewFolder}
        >
          {m.workspaceCreation_newProjectTab_selectFolder_label()}
        </Button>
      </div>
    </div>
  {/if}
</section>
