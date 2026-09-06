<script lang="ts">
  import BranchSelector from '$lib/components/workspace/initializer/BranchSelector.svelte';
  import IssueSuggestions, {
    type IssueSelectionData,
  } from '$lib/components/workspace/initializer/IssueSuggestions.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { ContextLink, DraftSource } from '$shared/types';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import { selectWorkspaceCreationBranchByRepo } from '$store/renderer/slices/workspace-creation-settings/workspace-creation-settings-selectors';
  import { issueSelectionPatch, sourceRepoKey, sourceWithBranch } from './setup-sections';

  interface Props {
    source: Exclude<DraftSource, { kind: 'newFolder' }>;
    intentText: string;
    contextLinks: ContextLink[];
    disabled?: boolean;
    onEdit?: (patch: {
      source?: DraftSource;
      intentText?: string;
      contextLinks?: ContextLink[];
    }) => void;
  }

  let { source, intentText, contextLinks, disabled = false, onEdit }: Props = $props();
  const githubConnected$ = selectGitHubAuthIsAuthenticated();
  const branchByRepo$ = selectWorkspaceCreationBranchByRepo();
  const repoKey = $derived(sourceRepoKey(source));
  const branch = $derived(source.branch ?? $branchByRepo$[repoKey] ?? '');
  let issueSource = $state<'github-issues' | 'github-prs'>('github-issues');

  function selectIssue(text: string, selection?: IssueSelectionData): void {
    if (!selection) return;
    const patch = issueSelectionPatch({ intentText, contextLinks }, text, selection);
    if (patch) onEdit?.(patch);
  }
</script>

<section class="grid gap-3 border-t border-border pt-4" data-testid="starting-point-section">
  <h3 class="type-caption font-medium text-foreground">
    {m.newWorkspace_setup_startingPoint_title()}
  </h3>
  <BranchSelector
    value={branch}
    repoPath={repoKey}
    repoType={source.kind}
    githubUrl={source.kind === 'github' ? source.url : undefined}
    {disabled}
    portal
    showTriggerChevron
    onchange={(event) => onEdit?.({ source: sourceWithBranch(source, event.detail.branch) })}
  />

  {#if source.kind === 'github' && $githubConnected$}
    <div class="overflow-hidden rounded-lg border border-border">
      <div class="flex gap-1 border-b border-border p-1">
        <button
          type="button"
          class="type-caption rounded-md px-2 py-1 {issueSource === 'github-issues'
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground'}"
          aria-pressed={issueSource === 'github-issues'}
          onclick={() => (issueSource = 'github-issues')}
          >{m.newWorkspace_setup_issues_label()}</button
        >
        <button
          type="button"
          class="type-caption rounded-md px-2 py-1 {issueSource === 'github-prs'
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground'}"
          aria-pressed={issueSource === 'github-prs'}
          onclick={() => (issueSource = 'github-prs')}
          >{m.newWorkspace_setup_pullRequests_label()}</button
        >
      </div>
      {#key issueSource}
        <IssueSuggestions
          onSelect={selectIssue}
          repositoryOwner={source.owner}
          repositoryName={source.name}
          initialSource={issueSource}
          initiallyExpanded
          hideToggle
          hideSourceTabs
        />
      {/key}
    </div>
  {/if}
</section>
