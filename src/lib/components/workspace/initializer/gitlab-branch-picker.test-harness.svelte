<script lang="ts">
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import GitLabBranchPicker from './GitLabBranchPicker.svelte';
  import type { GitLabBranchPickerProps } from './gitlab-picker-types';

  let page = $state<GitLabBranchPickerProps['page']>({
    status: 'ready',
    items: Array.from({ length: 12 }, (_, index) => ({
      name: `branch-${index}`,
      commitSha: 'a'.repeat(40),
    })),
    hasMore: true,
  });
  let selected = $state('');
  let open = $state(true);
  const copy = {
    searchLabel: 'Search branches',
    searchPlaceholder: 'Branch name',
    listLabel: 'GitLab branches',
    loadingLabel: 'Loading branches',
    emptyLabel: 'No branches',
    emptySearchLabel: 'No matches',
    loadMoreLabel: 'Load more branches',
    loadingMoreLabel: 'Loading more branches',
  };
</script>

<ContentDialog
  bind:open
  allowOverflow
  title="Choose the checkout branch"
  description="Browser fixture for the production branch control inside a modal."
>
  <GitLabBranchPicker
    scopeKey="connection-a/project-a"
    instanceBaseUrl="https://git.example.test:8443/Parent/Forge"
    projectPath="group/subgroup/service-with-a-long-project-name"
    query=""
    {page}
    {copy}
    placeholder="Choose a branch"
    protectedLabel="Protected"
    onSearch={() => {}}
    onMore={() => {
      if (page.status !== 'ready') return;
      page = {
        status: 'ready',
        items: [...page.items, { name: 'release/from-page-two', commitSha: 'b'.repeat(40) }],
        hasMore: false,
      };
    }}
    onSelect={(branch, scopeKey) => {
      selected = JSON.stringify({ ...branch, scopeKey });
    }}
  />
  <output data-testid="selected-branch">{selected}</output>
</ContentDialog>
