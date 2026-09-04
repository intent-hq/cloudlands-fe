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
  import { m } from '$shared/paraglide/messages.js';
  import type { DraftSource } from '$shared/types/workspace-draft';
  import type { SourcePresentation } from './types';

  interface Props {
    source: DraftSource | null;
    presentation?: SourcePresentation;
    disabled?: boolean;
    onChooseLocal?: () => void;
    onChooseGitHub?: () => void;
    onChooseNewFolder?: () => void;
  }

  let {
    source,
    presentation = {},
    disabled = false,
    onChooseLocal,
    onChooseGitHub,
    onChooseNewFolder,
  }: Props = $props();

  const state = $derived.by(() => {
    if (presentation.unresolvedLink) return 'unresolved-link';
    if (!source) return 'none';
    if (source.kind === 'local') return presentation.localKind === 'non-git' ? 'non-git' : 'local';
    if (source.kind === 'newFolder') return 'new-folder';
    if (presentation.githubAccess === 'no-access') return 'github-no-access';
    return presentation.githubAccess === 'private' ? 'github-private' : 'github-public';
  });

  const title = $derived.by(() => {
    switch (state) {
      case 'none':
        return m.newWorkspace_source_none_title();
      case 'unresolved-link':
        return m.newWorkspace_source_unresolved_title();
      case 'local':
        return m.workspace_hoverCard_localRepository_label();
      case 'non-git':
        return m.workspace_repoSelector_folderNotGitRepo_label();
      case 'new-folder':
        return m.onboarding_dirPicker_newFolder_label();
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
    if (!source) return m.workspace_compactInitializer_selectRepoHint_label();
    if (source.kind === 'local') return source.path;
    if (source.kind === 'newFolder') return `${source.parentPath}/${source.name}`;
    return `${source.owner}/${source.name}`;
  });
</script>

<section class="rounded-xl border border-border bg-card p-4" data-source-state={state}>
  <div class="flex items-start gap-3">
    <div class="mt-0.5 text-muted-foreground">
      {#if state === 'unresolved-link'}
        <Fa icon={faLink} />
      {:else if state === 'github-public'}
        <Fa icon={faGlobe} />
      {:else if state === 'github-private'}
        <Fa icon={faLock} />
      {:else if state === 'github-no-access'}
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
      {#if state === 'unresolved-link'}
        <p class="mt-2 text-xs text-muted-foreground">
          {m.newWorkspace_source_unresolved_description()}
        </p>
      {:else if state === 'non-git'}
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

  {#if state === 'none' || state === 'unresolved-link' || state === 'github-no-access'}
    <div class="mt-4 flex flex-wrap gap-2">
      <Button size="sm" variant="outline" {disabled} onclick={onChooseLocal}>
        {m.onboarding_projectPicker_localFolder_label()}
      </Button>
      <Button size="sm" variant="outline" {disabled} onclick={onChooseGitHub}>
        {m.onboarding_projectPicker_githubRepo_label()}
      </Button>
      <Button size="sm" variant="outline" {disabled} onclick={onChooseNewFolder}>
        {m.onboarding_dirPicker_newFolder_label()}
      </Button>
    </div>
  {/if}
</section>
