<script lang="ts">
  import GitRepoIcon from '$lib/components/icons/GitRepoIcon.svelte';
  import ServerIcon from '$lib/components/icons/ServerIcon.svelte';
  import Checkbox from '$lib/components/ui/checkbox/checkbox.svelte';
  import { faPlus, faSpinner } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import BranchSelector, { type BranchListInfo, type BranchStatus } from './BranchSelector.svelte';
  import RepoSelector from './RepoSelector.svelte';
  import {
    isolationNoun,
    resolveEffectiveIsolationMode,
    type IsolationMode,
  } from './isolation-mode';
  import { selectWorkspaceItems } from '$store/renderer/slices/workspace/workspace-selectors';
  import { m } from '$shared/paraglide/messages.js';

  type RepoSelectorHandle = {
    focusInput: () => void;
  };

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
    skipIsolation?: boolean;
    isNewRepo?: boolean;
    /** Suggested branch (e.g. from a PR) - highlights picker when different from selected */
    suggestedBranch?: string;
    /** Remote setup object when repoType is 'remote' */
    remoteSetup?: RemoteSetup | null;
    /** Callback when remote setup changes */
    onRemoteSetupChange?: (setup: RemoteSetup | null) => void;
    onRepoChange?: (event: CustomEvent<RepoChangeDetail>) => void;
    onBranchChange?: (event: CustomEvent<BranchChangeDetail>) => void;
    onSkipIsolationChange?: (value: boolean) => void;
    onGitHubAuthNeededChange?: (value: 'none' | 'not-authenticated' | 'no-access') => void;
    /** Callback when branch status changes (behind count, uncommitted changes) */
    onBranchStatusChange?: (status: BranchStatus) => void;
    /** Callback when the branch list has been fetched successfully */
    onBranchesLoaded?: (info: BranchListInfo) => void;
    /** Visual presentation for embedding in quiet metadata rows */
    presentation?: 'default' | 'metadata';
    /** Which picker field to render */
    field?: 'both' | 'repo' | 'branch';
    /** Shows a quiet branch metadata loading affordance */
    isLoading?: boolean;
  }

  let {
    repoPath = '',
    branch = '',
    repoType = 'local',
    githubUrl = '',
    skipIsolation = false,
    isNewRepo = false,
    suggestedBranch,
    remoteSetup = null,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onRemoteSetupChange,
    onRepoChange,
    onBranchChange,
    onSkipIsolationChange,
    onGitHubAuthNeededChange,
    onBranchStatusChange,
    onBranchesLoaded,
    presentation = 'default',
    field = 'both',
    isLoading = false,
  }: Props = $props();

  const isMetadataPresentation = $derived(presentation === 'metadata');

  // Effective isolated-checkout mode (worktree vs CoW clone) for creation copy.
  // Re-resolves when workspace items hydrate (cowSupported is read off them).
  const workspaceItemsForIsolation$ = selectWorkspaceItems();
  let isolationMode = $state<IsolationMode>('worktree');
  $effect(() => {
    void resolveEffectiveIsolationMode($workspaceItemsForIsolation$).then(
      (mode) => (isolationMode = mode),
    );
  });
  const isolationLabel = $derived(isolationNoun(isolationMode));
  const pickerClass = $derived(
    isMetadataPresentation
      ? 'block w-full min-w-0 text-sm text-foreground'
      : 'flex items-center flex-wrap gap-y-1',
  );
  const repoTriggerClass = $derived(
    isMetadataPresentation
      ? // i18n-ignore (Tailwind class list)
        'group/metadata-trigger min-w-0 rounded-md px-2! py-1! text-sm leading-5 font-normal text-foreground bg-transparent! hover:bg-muted/40! focus-visible:bg-muted/40 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0!'
      : // i18n-ignore (Tailwind class list)
        'pl-2.5 pr-1.5 font-medium bg-background! py-1.25! rounded-none ml-1',
  );
  const branchTriggerClass = $derived(
    isMetadataPresentation
      ? // i18n-ignore (Tailwind class list)
        'group/metadata-trigger w-full min-w-0 rounded-md px-2! py-1! text-sm leading-5 font-normal text-foreground bg-transparent! hover:bg-muted/40! focus-visible:bg-muted/40 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0! overflow-hidden'
      : // i18n-ignore (Tailwind class list)
        'pl-2.5 pr-1.5 font-medium bg-background! py-1.25! rounded-none overflow-hidden',
  );
  const metadataChevronClass = 'h-2.5 w-2.5 shrink-0 text-ghost opacity-70';
  const metadataValueClass = 'text-foreground font-normal';
  const metadataDefaultBranch = 'main';
  const isMetadataBranchLoading = $derived(
    isMetadataPresentation && field === 'branch' && isLoading,
  );

  // Format remote connection string for display
  const remoteDisplayPath = $derived(
    remoteSetup ? `${remoteSetup.username}@${remoteSetup.host}:${remoteSetup.workspacePath}` : '',
  );

  function formatRepoDisplayName(path: string): string {
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || path;
  }

  function formatGithubDisplayName(url: string): string {
    const normalized = url.trim().replace(/^git@github\.com:/, 'https://github.com/');
    try {
      const parsed = new URL(normalized.startsWith('http') ? normalized : `https://${normalized}`);
      if (parsed.hostname !== 'github.com') return formatRepoDisplayName(url);
      return parsed.pathname.replace(/^\//, '').replace(/\.git$/, '') || formatRepoDisplayName(url);
    } catch {
      return formatRepoDisplayName(url.replace(/\.git$/, ''));
    }
  }

  const metadataRepoName = $derived.by(() => {
    const repoName =
      repoType === 'remote' && remoteSetup
        ? remoteSetup.name
        : repoType === 'github' && githubUrl
          ? formatGithubDisplayName(githubUrl)
          : formatRepoDisplayName(repoPath);
    return repoName;
  });
  const metadataBranchName = $derived(
    (repoType === 'remote' && remoteSetup ? remoteSetup.branch || branch : branch) ||
      metadataDefaultBranch,
  );
  const metadataRepoLabel = $derived(
    metadataRepoName ? `${metadataRepoName}/${metadataBranchName}` : '',
  );
  const repoOnlyValue = $derived(
    repoType === 'remote' && remoteSetup
      ? remoteSetup.name
      : repoType === 'github' && githubUrl
        ? githubUrl
        : repoPath,
  );
  const repoOnlyDisplayValue = $derived(isMetadataPresentation ? metadataRepoName : undefined);
  const branchRepoPath = $derived(
    repoPath || (repoType === 'remote' && remoteSetup ? remoteSetup.workspacePath : ''),
  );

  function handleRepoChange(event: CustomEvent<RepoChangeDetail>) {
    onRepoChange?.(event);
  }

  function handleBranchChange(event: CustomEvent<BranchChangeDetail>) {
    onBranchChange?.(event);
  }

  // Derive whether we have a repo selected
  const hasRepo = $derived(
    !!repoPath ||
      (repoType === 'github' && !!githubUrl) ||
      (repoType === 'remote' && !!remoteSetup),
  );

  // Ref to RepoSelector for focusing the input
  let repoSelector = $state<RepoSelectorHandle | undefined>();

  /**
   * Focus the repo input field
   * Used by parent components to focus the input after prefill
   */
  export function focusInput() {
    repoSelector?.focusInput?.();
  }
</script>

<div class={pickerClass}>
  {#if field === 'repo'}
    <RepoSelector
      bind:this={repoSelector}
      variant="ghost"
      value={repoOnlyValue}
      onchange={handleRepoChange}
      triggerClass={repoTriggerClass}
      displayValue={repoOnlyDisplayValue}
      triggerValueClass={isMetadataPresentation ? metadataValueClass : undefined}
      triggerContentClass={isMetadataPresentation ? 'gap-1.5' : 'gap-0.75'}
      showTriggerChevron={isMetadataPresentation}
      triggerChevronClass={metadataChevronClass}
    />
  {:else if field === 'branch'}
    <div class="relative min-w-0">
      <BranchSelector
        variant="ghost"
        triggerClass={branchTriggerClass}
        value={metadataBranchName}
        repoPath={branchRepoPath}
        repoType={repoType as 'local' | 'github'}
        {githubUrl}
        {skipIsolation}
        {suggestedBranch}
        hasTriggerIcon={false}
        disabled={false}
        showUncommittedIndicator={true}
        showTriggerChevron={isMetadataPresentation && !isMetadataBranchLoading}
        triggerChevronClass={metadataChevronClass}
        triggerContentClass={isMetadataPresentation
          ? `w-full gap-1.5 ${isMetadataBranchLoading ? 'pr-5' : ''}`
          : undefined}
        onSkipIsolationChange={(value) => onSkipIsolationChange?.(value)}
        onGitHubAuthNeededChange={(value) => onGitHubAuthNeededChange?.(value)}
        {onBranchStatusChange}
        {onBranchesLoaded}
        onchange={handleBranchChange}
      />
      {#if isMetadataBranchLoading}
        <Fa
          icon={faSpinner}
          class="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-subtle"
        />
      {/if}
    </div>
  {:else if !hasRepo}
    <!-- No repo selected: show repo selector pill -->
    {#if !isMetadataPresentation}
      <span class="text-sm text-subtle whitespace-nowrap shrink-0">{m.workspace_repoAndBranchPicker_workOn_label()}</span>
    {/if}
    <RepoSelector
      bind:this={repoSelector}
      variant="ghost"
      value=""
      onchange={handleRepoChange}
      triggerClass={repoTriggerClass}
      triggerValueClass={isMetadataPresentation ? metadataValueClass : undefined}
      triggerContentClass={isMetadataPresentation ? 'gap-1.5' : 'gap-0.75'}
      showTriggerChevron={isMetadataPresentation}
      triggerChevronClass={metadataChevronClass}
    />
  {:else if isNewRepo}
    <!-- New repo mode: show create with repo selector -->
    {#if !isMetadataPresentation}
      <Fa icon={faPlus} size="sm" class="ml-0.75 mr-2 shrink-0" />
      <span class="text-sm text-subtle whitespace-nowrap shrink-0">{m.workspace_repoAndBranchPicker_createNewRepo_label()}</span>
    {/if}
    <RepoSelector
      variant="ghost"
      value={repoPath}
      onchange={handleRepoChange}
      triggerClass={repoTriggerClass}
      displayValue={isMetadataPresentation ? metadataRepoLabel : undefined}
      triggerValueClass={isMetadataPresentation ? metadataValueClass : undefined}
      triggerContentClass={isMetadataPresentation ? 'gap-1.5' : 'gap-0.75'}
      showTriggerChevron={isMetadataPresentation}
      triggerChevronClass={metadataChevronClass}
    />
  {:else if repoType === 'github' && githubUrl && isMetadataPresentation}
    <RepoSelector
      variant="ghost"
      value={repoPath}
      onchange={handleRepoChange}
      triggerClass={repoTriggerClass}
      displayValue={metadataRepoLabel}
      triggerValueClass={metadataValueClass}
      triggerContentClass="gap-1.5"
      showTriggerChevron={true}
      triggerChevronClass={metadataChevronClass}
    />
  {:else if repoType === 'github' && githubUrl}
    <!-- GitHub clone flow -->
    {#if !isMetadataPresentation}
      <GitRepoIcon size={16} class="ml-0.75 -mb-px mr-2 shrink-0" />
      <span class="text-sm text-subtle whitespace-nowrap shrink-0">{m.workspace_repoAndBranchPicker_clone_label()}</span>
    {/if}
    <RepoSelector
      variant="ghost"
      value={repoPath}
      onchange={handleRepoChange}
      triggerClass={repoTriggerClass}
      triggerValueClass={isMetadataPresentation ? metadataValueClass : undefined}
      triggerContentClass="gap-0.75"
      showTriggerChevron={isMetadataPresentation}
      triggerChevronClass={metadataChevronClass}
    />
    <span class="text-sm text-subtle whitespace-nowrap shrink-0 ml-1">
      {isMetadataPresentation
        ? m.workspace_repoAndBranchPicker_off_label()
        : m.workspace_repoAndBranchPicker_andCreateOff_label({ isolationLabel })}
    </span>
    <BranchSelector
      variant="ghost"
      triggerClass={branchTriggerClass}
      value={branch}
      repoPath={repoPath || ''}
      repoType={repoType as 'local' | 'github'}
      {githubUrl}
      {skipIsolation}
      {suggestedBranch}
      hasTriggerIcon={false}
      disabled={!repoPath}
      showUncommittedIndicator={true}
      showTriggerChevron={isMetadataPresentation}
      triggerChevronClass={metadataChevronClass}
      triggerContentClass={isMetadataPresentation ? 'w-full gap-1.5' : undefined}
      onSkipIsolationChange={(value) => onSkipIsolationChange?.(value)}
      onGitHubAuthNeededChange={(value) => onGitHubAuthNeededChange?.(value)}
      {onBranchStatusChange}
      {onBranchesLoaded}
      onchange={handleBranchChange}
    />
  {:else if repoType === 'remote' && remoteSetup && isMetadataPresentation}
    <RepoSelector
      variant="ghost"
      value={remoteSetup.name}
      onchange={handleRepoChange}
      triggerClass={repoTriggerClass}
      displayValue={metadataRepoLabel}
      triggerValueClass={metadataValueClass}
      triggerContentClass="gap-1.5"
      showTriggerChevron={true}
      triggerChevronClass={metadataChevronClass}
    />
  {:else if repoType === 'remote' && remoteSetup}
    <!-- Remote server flow -->
    {#if !isMetadataPresentation}
      <ServerIcon size={16} class="text-ghost ml-0.75 -mb-px mr-2 shrink-0" />
      <span class="text-sm text-subtle whitespace-nowrap shrink-0">{m.workspace_repoAndBranchPicker_workOn_label()}</span>
    {/if}
    <RepoSelector
      variant="ghost"
      value={remoteSetup.name}
      onchange={handleRepoChange}
      triggerClass={repoTriggerClass}
      triggerValueClass={isMetadataPresentation ? metadataValueClass : undefined}
      triggerContentClass="gap-0.75"
      showTriggerChevron={isMetadataPresentation}
      triggerChevronClass={metadataChevronClass}
    />
    <span
      class="text-xs text-subtle whitespace-nowrap shrink-0 ml-1 font-mono truncate max-w-60"
      title={remoteDisplayPath}
    >
      {remoteDisplayPath}
    </span>
    {#if skipIsolation}
      <span class="text-sm text-subtle whitespace-nowrap shrink-0 mx-1 ml-2">{m.workspace_repoAndBranchPicker_on_label()}</span>
    {:else}
      <span class="text-sm text-subtle whitespace-nowrap shrink-0 mx-1 ml-2">{m.workspace_repoAndBranchPicker_off_label()}</span>
    {/if}
    <span class="text-sm font-medium whitespace-nowrap shrink-0 font-mono"
      >{remoteSetup.branch || 'main'}</span
    >
    <!-- Skip isolation toggle for remote -->
    {#if typeof onSkipIsolationChange === 'function'}
      <button
        type="button"
        onclick={() => onSkipIsolationChange?.(!skipIsolation)}
        class="flex items-center gap-1.5 ml-3 shrink-0 cursor-pointer"
      >
        <Checkbox
          checked={skipIsolation}
          class="-mb-0.5"
          onCheckedChange={(value) => onSkipIsolationChange?.(value)}
        />
        <span class="text-ui text-subtle whitespace-nowrap"> {m.workspace_repoAndBranchPicker_workDirectly_label()} </span>
      </button>
    {/if}
  {:else if isMetadataPresentation}
    <RepoSelector
      variant="ghost"
      value={repoPath}
      onchange={handleRepoChange}
      triggerClass={repoTriggerClass}
      displayValue={metadataRepoLabel}
      triggerValueClass={metadataValueClass}
      triggerContentClass="gap-1.5"
      showTriggerChevron={true}
      triggerChevronClass={metadataChevronClass}
    />
  {:else}
    <!-- Local repo flow -->
    {#if !isMetadataPresentation}
      <GitRepoIcon size={16} class="ml-0.75 -mb-px mr-2 shrink-0" />
      <span class="text-sm text-subtle whitespace-nowrap shrink-0">{m.workspace_repoAndBranchPicker_workOn_label()}</span>
    {/if}
    <RepoSelector
      variant="ghost"
      value={repoPath}
      onchange={handleRepoChange}
      triggerClass={repoTriggerClass}
      triggerValueClass={isMetadataPresentation ? metadataValueClass : undefined}
      triggerContentClass="gap-0.75"
      showTriggerChevron={isMetadataPresentation}
      triggerChevronClass={metadataChevronClass}
    />
    <span class="text-sm text-subtle whitespace-nowrap shrink-0 mx-1 ml-2">{m.workspace_repoAndBranchPicker_off_label()}</span>
    <BranchSelector
      variant="ghost"
      triggerClass={branchTriggerClass}
      value={branch}
      repoPath={repoPath || ''}
      repoType={repoType as 'local' | 'github'}
      {githubUrl}
      {skipIsolation}
      {suggestedBranch}
      hasTriggerIcon={false}
      disabled={!repoPath}
      showUncommittedIndicator={true}
      showTriggerChevron={isMetadataPresentation}
      triggerChevronClass={metadataChevronClass}
      triggerContentClass={isMetadataPresentation ? 'w-full gap-1.5' : undefined}
      onSkipIsolationChange={(value) => onSkipIsolationChange?.(value)}
      onGitHubAuthNeededChange={(value) => onGitHubAuthNeededChange?.(value)}
      {onBranchStatusChange}
      {onBranchesLoaded}
      onchange={handleBranchChange}
    />
  {/if}
</div>
