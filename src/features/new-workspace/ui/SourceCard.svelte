<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import Input from '$lib/components/ui/input/input.svelte';
  import RepoSelector, {
    type RepoChangeDetail,
  } from '$lib/components/workspace/initializer/RepoSelector.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { m } from '$shared/paraglide/messages.js';
  import type { DraftSource } from '$shared/types/workspace-draft';
  import { getNewFolderNameError, type NewFolderNameError, type SourcePresentation } from './types';

  export type SourcePickerMode = 'local' | 'github' | 'new-folder';

  interface Props {
    source: DraftSource | null;
    presentation?: SourcePresentation;
    disabled?: boolean;
    showSummary?: boolean;
    pickerOpen?: boolean;
    pickerMode?: SourcePickerMode;
    onPickerOpenChange?: (open: boolean) => void;
    onChooseNewFolder?: (name: string) => void;
    onSourceSelected?: (source: DraftSource) => void;
  }

  let {
    source,
    presentation = {},
    disabled = false,
    showSummary = true,
    pickerOpen = false,
    pickerMode = 'github',
    onPickerOpenChange,
    onChooseNewFolder,
    onSourceSelected,
  }: Props = $props();

  const fieldId = $props.id();

  // i18n-ignore (default filesystem-safe directory name)
  let newFolderName = $state('my-project');
  const newFolderNameError = $derived(getNewFolderNameError(newFolderName));
  const activeNewFolderError = $derived(
    source?.kind === 'newFolder' ? getNewFolderNameError(source.name) : newFolderNameError,
  );

  const sourceState = $derived.by(() => {
    if (presentation.unresolvedLink) return 'unresolved-link';
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
    if (!newFolderNameError) {
      onChooseNewFolder?.(newFolderName.trim());
      onPickerOpenChange?.(false);
    }
  }

  function selectRepo(event: CustomEvent<RepoChangeDetail>): void {
    const selection = event.detail;
    if (selection.type === 'github') {
      const url = selection.githubUrl || selection.path;
      const match = url.match(/github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?$/);
      if (!match) return;
      onSourceSelected?.({ kind: 'github', url, owner: match[1], name: match[2] });
      onPickerOpenChange?.(false);
      return;
    }
    if (selection.type === 'local' && selection.path) {
      onSourceSelected?.({ kind: 'local', path: selection.path, isolation: 'worktree' });
      onPickerOpenChange?.(false);
    }
  }
</script>

{#if showSummary}
  <div class="space-y-2" data-source-state={sourceState}>
    <div class="type-caption min-w-0 text-muted-foreground">
      <p class="font-medium text-foreground">{title}</p>
      {#if sourceState !== 'none'}
        <p class="mt-1 break-all">{summary}</p>
      {/if}
      {#if sourceState === 'new-folder-invalid' && activeNewFolderError}
        <p class="mt-1 text-danger" role="alert">{errorLabel(activeNewFolderError)}</p>
      {:else if sourceState === 'unresolved-link'}
        <p class="mt-1">{m.newWorkspace_source_unresolved_description()}</p>
      {:else if sourceState === 'non-git'}
        <p class="mt-1">{m.workspace_validation_nonGitInit_warning()}</p>
      {/if}
      {#if !disabled}
        <p class="mt-2">{m.newWorkspace_source_composerMenu_description()}</p>
      {/if}
    </div>

    {#if source?.kind === 'local' || source?.kind === 'github'}
      <details class="type-caption">
        <summary
          class="min-h-6 cursor-pointer rounded-sm font-medium text-muted-foreground hover:text-foreground active:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
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
  </div>
{/if}

<Dialog.Root open={pickerOpen} onOpenChange={(open) => onPickerOpenChange?.(open)}>
  <Dialog.Content class="max-w-md" data-testid="draft-source-picker">
    <Dialog.Header>
      <Dialog.Title>
        {pickerMode === 'new-folder'
          ? m.newWorkspace_source_newProject_title()
          : m.newWorkspace_source_title()}
      </Dialog.Title>
      <Dialog.Description>
        {pickerMode === 'new-folder'
          ? m.newWorkspace_source_newProject_description()
          : m.workspace_repoSelector_whichRepo_description()}
      </Dialog.Description>
    </Dialog.Header>

    {#if pickerMode === 'new-folder'}
      <label for={fieldId} class="type-caption font-medium">
        {m.newWorkspace_source_folderName_label()}
      </label>
      <div class="flex flex-col gap-2 sm:flex-row">
        <Input
          id={fieldId}
          aria-describedby={newFolderNameError ? `${fieldId}-error` : undefined}
          value={newFolderName}
          oninput={(event) => (newFolderName = event.currentTarget.value)}
          placeholder={m.workspaceCreation_newProjectTab_projectName_placeholder()}
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
      {#if newFolderNameError}
        <p id={`${fieldId}-error`} class="type-caption text-danger" role="alert">
          {errorLabel(newFolderNameError)}
        </p>
      {/if}
    {:else}
      <RepoSelector
        value=""
        initialTab={pickerMode}
        onchange={selectRepo}
        triggerClass="w-full justify-start"
        emptyLabel={m.workspace_repoSelector_selectRepository_label()}
        showEmptyIcon
        showTriggerChevron
      />
    {/if}
  </Dialog.Content>
</Dialog.Root>
