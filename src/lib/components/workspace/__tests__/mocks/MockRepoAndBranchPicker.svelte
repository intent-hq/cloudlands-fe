<script lang="ts">
  /**
   * Minimal RepoAndBranchPicker stand-in for CompactWorkspaceInitializer
   * tests. Exposes the repo/branch change callbacks on `window` so tests can
   * drive selection changes (e.g. a branch switch that must re-probe the
   * repo config, monorepo#835) without rendering the real picker, and
   * surfaces the detected GitHub owner/repo props so tests can observe the
   * repo pill's `(owner/repo)` suffix source.
   */
  let {
    onRepoChange,
    onBranchChange,
    onSkipIsolationChange,
    onBranchStatusChange,
    detectedGitHubOwner = null,
    detectedGitHubRepo = null,
    repoPath = '',
    repoType = 'local',
    githubUrl = '',
    branch = '',
    skipIsolation = false,
    isNewRepo = false,
    remoteSetup = null,
    plainFolderMode = false,
    plainFolder = null,
    gitChoice = undefined,
    sessions = undefined,
  }: {
    onRepoChange?: (event: { detail: Record<string, unknown> }) => void;
    onBranchChange?: (event: { detail: { branch: string } }) => void;
    onSkipIsolationChange?: (value: boolean) => void;
    onBranchStatusChange?: (status: {
      behind: number;
      hasUncommittedChanges: boolean;
      currentBranch: string;
      isCurrentBranch: boolean;
      isLoading: boolean;
    }) => void;
    detectedGitHubOwner?: string | null;
    detectedGitHubRepo?: string | null;
    repoPath?: string;
    repoType?: string;
    githubUrl?: string;
    branch?: string;
    skipIsolation?: boolean;
    isNewRepo?: boolean;
    remoteSetup?: { workspacePath?: string } | null;
    plainFolderMode?: boolean;
    plainFolder?: string | null;
    gitChoice?: {
      checked: boolean;
      folder?: 'git-repo' | 'folder' | null;
      worktree?: boolean;
      disabled?: boolean;
      onCheckedChange: (checked: boolean, tab: 'local' | 'new') => void;
    };
    sessions?: {
      selected: { title: string; sessionId: string } | null;
      onSelect: (session: Record<string, unknown>) => void;
    };
    [key: string]: unknown;
  } = $props();

  /** Records the initializer's "reopen folder selection" requests (by tab). */
  export function openFolderSelection(tab: 'local' | 'new' = 'local') {
    const registry = window as unknown as Record<string, unknown>;
    registry.__mockRepoAndBranchPickerFolderOpens =
      ((registry.__mockRepoAndBranchPickerFolderOpens as number | undefined) ?? 0) + 1;
    registry.__mockRepoAndBranchPickerFolderOpenTabs = [
      ...((registry.__mockRepoAndBranchPickerFolderOpenTabs as string[] | undefined) ?? []),
      tab,
    ];
  }

  /** The folder tab the stand-in's git choice is flipped in (tests may change it). */
  const gitChoiceTab = () =>
    ((window as unknown as Record<string, unknown>).__mockRepoAndBranchPickerGitChoiceTab as
      'local' | 'new' | undefined) ?? 'local';

  $effect(() => {
    const registry = window as unknown as Record<string, unknown>;
    const callbacks = {
      onRepoChange,
      onBranchChange,
      onSkipIsolationChange,
      onBranchStatusChange,
      onSessionSelect: sessions?.onSelect,
    };
    registry.__mockRepoAndBranchPicker = callbacks;
    return () => {
      if (registry.__mockRepoAndBranchPicker === callbacks) {
        delete registry.__mockRepoAndBranchPicker;
      }
    };
  });
</script>

<div data-testid="detected-github-owner">{detectedGitHubOwner ?? ''}</div>
<div data-testid="detected-github-repo">{detectedGitHubRepo ?? ''}</div>
<div data-testid="picker-repo-path">{repoPath}</div>
<div data-testid="picker-repo-type">{repoType}</div>
<div data-testid="picker-github-url">{githubUrl}</div>
<div data-testid="picker-branch">{branch}</div>
<div data-testid="picker-skip-isolation">{String(skipIsolation)}</div>
<div data-testid="picker-is-new-repo">{String(isNewRepo)}</div>
<div data-testid="picker-remote-path">{remoteSetup?.workspacePath ?? ''}</div>
<div data-testid="picker-plain-folder-mode">{String(plainFolderMode)}</div>
<div data-testid="picker-plain-folder">{plainFolder ?? ''}</div>
<div data-testid="picker-session">{sessions?.selected?.sessionId ?? ''}</div>
{#if gitChoice}
  <!-- Stands in for the git choice inside the picker's Existing folder / New tabs:
       a picked git repo shows its worktree setting, anything else the git choice. -->
  {@const checked =
    gitChoiceTab() === 'local' && gitChoice.folder === 'git-repo'
      ? !!gitChoice.worktree
      : gitChoice.checked}
  <button
    type="button"
    role="switch"
    data-testid="picker-git-choice"
    aria-checked={checked ? 'true' : 'false'}
    disabled={gitChoice.disabled}
    onclick={() => gitChoice.onCheckedChange(!checked, gitChoiceTab())}>git choice</button
  >
  <div data-testid="picker-git-choice-folder">{gitChoice.folder ?? ''}</div>
{/if}
