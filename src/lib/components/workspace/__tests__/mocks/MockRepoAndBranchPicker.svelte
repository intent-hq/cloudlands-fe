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
    detectedGitHubOwner = null,
    detectedGitHubRepo = null,
  }: {
    onRepoChange?: (event: { detail: Record<string, unknown> }) => void;
    onBranchChange?: (event: { detail: { branch: string } }) => void;
    detectedGitHubOwner?: string | null;
    detectedGitHubRepo?: string | null;
    [key: string]: unknown;
  } = $props();

  $effect(() => {
    const registry = window as unknown as Record<string, unknown>;
    const callbacks = { onRepoChange, onBranchChange };
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
