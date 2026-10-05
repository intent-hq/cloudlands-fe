<script module lang="ts">
  import type { ComponentProps } from 'svelte';
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import WorkspaceSetupCard from './WorkspaceSetupCard.svelte';

  type Props = ComponentProps<typeof WorkspaceSetupCard>;
  const base: Props = {
    repoName: 'sample-project',
    repoPath: '/demo/sample-project',
    worktreePath: '/demo/workspaces/ui-polish',
    branch: 'ui-polish',
    baseRef: 'origin/main',
    specialistId: 'developer',
    projectType: 'Node.js',
    onFocusSetupTerminal: () => {},
  };

  export const preview = definePreview<Props>({
    id: 'workspace-setup-card',
    title: 'Workspace setup card',
    defaultState: 'ready',
    states: {
      starting: {
        props: { ...base, repoStatus: 'active', branchStatus: 'active', agentStatus: 'active' },
      },
      ready: {
        props: {
          ...base,
          repoStatus: 'done',
          branchStatus: 'done',
          setupScriptStatus: 'done',
          agentStatus: 'done',
        },
      },
      'long-path': {
        props: {
          ...base,
          repoStatus: 'done',
          branchStatus: 'done',
          agentStatus: 'done',
          worktreePath: '/demo/workspaces/a-very-long-workspace-name-for-inline-wrapping',
          branch: 'a-very-long-feature-branch-name-for-wrapping',
        },
      },
    },
  });
</script>

<script lang="ts">
  let props: Props = $props();
</script>

<WorkspaceSetupCard {...props} />
