<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview<{ state: string }>({
    id: 'pull-conflict-audit',
    title: 'Pull conflict audit',
    defaultState: 'merge',
    states: Object.fromEntries(
      ['unstaged', 'stash', 'merge', 'unknown'].map((state) => [state, { props: { state } }]),
    ),
  });
</script>

<script lang="ts">
  import PullConflictDialog from './PullConflictDialog.svelte';
  let { state = 'merge' }: { state?: string } = $props();
  const errors: Record<string, string> = {
    unstaged: 'Cannot pull with rebase: you have unstaged changes. Please commit or stash them.',
    stash:
      'Pull completed, but stash pop encountered a conflict. Your changes are saved in the stash.',
    merge:
      'CONFLICT (content): Merge conflict in src/components/workspace/LongComponentName.svelte\nAutomatic merge failed; fix conflicts and then commit the result.',
    unknown:
      'Unable to contact the remote repository. Check your network connection and repository access.',
  };
</script>

<PullConflictDialog
  open
  static
  staticData={{ editors: [] }}
  error={errors[state]}
  repoPath="/fixture/design-system"
  branchName="refine-modal-layout"
/>
