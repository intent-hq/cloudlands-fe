<script lang="ts">
  interface Props {
    repoPath?: string;
    branch?: string;
    repoType?: 'local' | 'github' | 'remote';
    githubUrl?: string;
    isNewRepo?: boolean;
    presentation?: 'default' | 'metadata';
    field?: 'both' | 'repo' | 'branch';
    isLoading?: boolean;
    onRepoChange?: (event: CustomEvent<any>) => void;
    onBranchChange?: (event: CustomEvent<{ branch: string }>) => void;
  }

  let {
    repoPath = '',
    branch = '',
    repoType = 'local',
    githubUrl = '',
    isNewRepo = false,
    presentation = 'default',
    field = 'both',
    isLoading = false,
    onRepoChange,
    onBranchChange,
  }: Props = $props();
</script>

<div
  data-testid="mock-repo-and-branch-picker"
  data-presentation={presentation}
  data-field={field}
  data-is-loading={String(isLoading)}
>
  <span>{repoPath}</span>
  <span>{branch}</span>
  <span>{repoType}</span>
  <span>{githubUrl}</span>
  <span>{String(isNewRepo)}</span>
  {#if field !== 'branch'}
    <button
      type="button"
      onclick={() =>
        onRepoChange?.(
          new CustomEvent('change', {
            detail: { path: '/repo/mock', type: 'local', isValidPath: true, scope: 'src' },
          }),
        )}
    >
      Mock repo change
    </button>
  {/if}
  {#if field !== 'repo'}
    <button
      type="button"
      onclick={() =>
        onBranchChange?.(new CustomEvent('change', { detail: { branch: 'mock-branch' } }))}
    >
      Mock branch change
    </button>
  {/if}
</div>
