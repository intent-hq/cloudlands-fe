<script lang="ts">
  import GitRepoIcon from '$lib/components/icons/GitRepoIcon.svelte';
  import ServerIcon from '$lib/components/icons/ServerIcon.svelte';
  import { faPlus } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import BranchSelector, { type BranchStatus } from './BranchSelector.svelte';
  import RepoSelector from './RepoSelector.svelte';

  export interface RemoteSetup {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    password?: string;
    keyPath?: string;
    useAgent?: boolean;
    workspacePath: string;
    lastUsedRepo?: string;
    lastUsed?: string;
    transport?: 'ssh' | 'websocket';
    wsUrl?: string;
    branch?: string;
  }

  export interface RepoChangeDetail {
    path: string;
    type: 'local' | 'github' | 'remote';
    githubUrl?: string;
    clonePath?: string;
    isNewRepo?: boolean;
    isValidPath?: boolean;
    scope?: string;
    remoteSetup?: RemoteSetup;
  }

  export interface BranchChangeDetail {
    branch: string;
  }

  interface Props {
    repoPath?: string;
    branch?: string;
    repoType?: 'local' | 'github' | 'remote';
    githubUrl?: string;
    skipWorktree?: boolean;
    isNewRepo?: boolean;
    /** Suggested branch (e.g. from a PR) - highlights picker when different from selected */
    suggestedBranch?: string;
    /** Remote setup object when repoType is 'remote' */
    remoteSetup?: RemoteSetup | null;
    /** Callback when remote setup changes */
    onRemoteSetupChange?: (setup: RemoteSetup | null) => void;
    onRepoChange?: (event: CustomEvent<RepoChangeDetail>) => void;
    onBranchChange?: (event: CustomEvent<BranchChangeDetail>) => void;
    onSkipWorktreeChange?: (value: boolean) => void;
    onGitHubAuthNeededChange?: (value: 'none' | 'not-authenticated' | 'no-access') => void;
    /** Callback when branch status changes (behind count, uncommitted changes) */
    onBranchStatusChange?: (status: BranchStatus) => void;
  }

  let {
    repoPath = '',
    branch = '',
    repoType = 'local',
    githubUrl = '',
    skipWorktree = false,
    isNewRepo = false,
    suggestedBranch,
    remoteSetup = null,
    onRemoteSetupChange,
    onRepoChange,
    onBranchChange,
    onSkipWorktreeChange,
    onGitHubAuthNeededChange,
    onBranchStatusChange,
  }: Props = $props();

  // Format remote connection string for display
  const remoteDisplayPath = $derived(
    remoteSetup ? `${remoteSetup.username}@${remoteSetup.host}:${remoteSetup.workspacePath}` : '',
  );

  function handleRepoChange(event: CustomEvent<RepoChangeDetail>) {
    onRepoChange?.(event);
  }

  function handleBranchChange(event: CustomEvent<BranchChangeDetail>) {
    onBranchChange?.(event);
  }

  // Derive whether we have a repo selected
  const hasRepo = $derived(!!repoPath);

  // Ref to RepoSelector for focusing the input
  let repoSelector: any;

  /**
   * Focus the repo input field
   * Used by parent components to focus the input after prefill
   */
  export function focusInput() {
    repoSelector?.focusInput?.();
  }
</script>

<div class="flex items-center flex-wrap gap-y-1">
  {#if !hasRepo}
    <!-- No repo selected: show repo selector pill -->
    <span class="text-sm text-muted-foreground whitespace-nowrap shrink-0">Work on</span>
    <RepoSelector
      bind:this={repoSelector}
      variant="ghost"
      value=""
      onchange={handleRepoChange}
      triggerClass="pl-1.5 pr-1 font-medium bg-background! py-0.75! rounded-none ml-1"
    />
  {:else if isNewRepo}
    <!-- New repo mode: show create with repo selector -->
    <Fa icon={faPlus} size="sm" class="text-muted-foreground ml-0.75 mr-2 shrink-0" />
    <span class="text-sm text-muted-foreground whitespace-nowrap shrink-0">Create new repo</span>
    <RepoSelector
      variant="ghost"
      value={repoPath}
      onchange={handleRepoChange}
      triggerClass="pl-1.5 pr-1 font-medium bg-background! py-0.75! rounded-none ml-1"
    />
  {:else if repoType === 'github' && githubUrl}
    <!-- GitHub clone flow -->
    <GitRepoIcon size={16} class="text-muted-foreground ml-0.75 -mb-px mr-2 shrink-0" />
    <span class="text-sm text-muted-foreground whitespace-nowrap shrink-0">Clone</span>
    <RepoSelector
      variant="ghost"
      value={repoPath}
      onchange={handleRepoChange}
      triggerClass="pl-1.5 pr-1 font-medium bg-background! py-0.75! rounded-none ml-1"
    />
    <span class="text-sm text-muted-foreground whitespace-nowrap shrink-0 ml-1"
      >and create worktree off</span
    >
    <BranchSelector
      variant="ghost"
      triggerClass="pl-1.5 pr-1.5 font-medium bg-background! py-0.75! rounded-none overflow-hidden"
      value={branch}
      repoPath={repoPath || ''}
      repoType={repoType as 'local' | 'github'}
      {githubUrl}
      {skipWorktree}
      {suggestedBranch}
      hasTriggerIcon={false}
      disabled={!repoPath}
      showUncommittedIndicator={true}
      onSkipWorktreeChange={(value) => onSkipWorktreeChange?.(value)}
      onGitHubAuthNeededChange={(value) => onGitHubAuthNeededChange?.(value)}
      {onBranchStatusChange}
      onchange={handleBranchChange}
    />
  {:else if repoType === 'remote' && remoteSetup}
    <!-- Remote server flow -->
    <ServerIcon size={16} class="text-muted-foreground ml-0.75 -mb-px mr-2 shrink-0" />
    <span class="text-sm text-muted-foreground whitespace-nowrap shrink-0">Work on</span>
    <RepoSelector
      variant="ghost"
      value={remoteSetup.name}
      onchange={handleRepoChange}
      triggerClass="pl-1.5 pr-1 font-medium bg-background! py-0.75! rounded-none ml-1"
    />
    <span
      class="text-xs text-muted-foreground/70 whitespace-nowrap shrink-0 ml-1 font-mono truncate max-w-60"
      title={remoteDisplayPath}
    >
      {remoteDisplayPath}
    </span>
    <span class="text-sm text-muted-foreground whitespace-nowrap shrink-0 mx-1 ml-2">off</span>
    <span class="text-sm font-medium whitespace-nowrap shrink-0 font-mono">{remoteSetup.branch || 'main'}</span>
  {:else}
    <!-- Local repo flow -->
    <GitRepoIcon size={16} class="text-muted-foreground ml-0.75 -mb-px mr-2 shrink-0" />
    <span class="text-sm text-muted-foreground whitespace-nowrap shrink-0">Work on</span>
    <RepoSelector
      variant="ghost"
      value={repoPath}
      onchange={handleRepoChange}
      triggerClass="pl-1.5 pr-1 font-medium bg-background! py-0.75! rounded-none ml-1"
    />
    <span class="text-sm text-muted-foreground whitespace-nowrap shrink-0 mx-1 ml-2">off</span>
    <BranchSelector
      variant="ghost"
      triggerClass="pl-1.5 pr-1.5 font-medium bg-background! py-0.75! rounded-none overflow-hidden"
      value={branch}
      repoPath={repoPath || ''}
      repoType={repoType as 'local' | 'github'}
      {githubUrl}
      {skipWorktree}
      {suggestedBranch}
      hasTriggerIcon={false}
      disabled={!repoPath}
      showUncommittedIndicator={true}
      onSkipWorktreeChange={(value) => onSkipWorktreeChange?.(value)}
      onGitHubAuthNeededChange={(value) => onGitHubAuthNeededChange?.(value)}
      {onBranchStatusChange}
      onchange={handleBranchChange}
    />
  {/if}
</div>
