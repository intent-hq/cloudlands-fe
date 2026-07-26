<script lang="ts">
  /**
   * Minimal RepoAndBranchPicker stand-in for CompactWorkspaceInitializer
   * tests. Exposes the repo/branch change callbacks on `window` so tests can
   * drive selection changes (e.g. a branch switch that must re-probe the
   * repo config, monorepo#835) without rendering the real picker.
   */
  let {
    onRepoChange,
    onBranchChange,
  }: {
    onRepoChange?: (event: { detail: Record<string, unknown> }) => void;
    onBranchChange?: (event: { detail: { branch: string } }) => void;
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
