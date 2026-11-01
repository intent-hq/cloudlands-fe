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
    [key: string]: unknown;
  } = $props();

  $effect(() => {
    const registry = window as unknown as Record<string, unknown>;
    const callbacks = { onRepoChange, onBranchChange, onSkipIsolationChange, onBranchStatusChange };
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
