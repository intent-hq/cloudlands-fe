<script module lang="ts">
  import type { ComponentProps } from 'svelte';
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import WorkspaceSetupCard from './WorkspaceSetupCard.svelte';
  import { store } from '$store/renderer/store';
  import {
    beginWorkspaceCreateProgress,
    clearWorkspaceCreateProgress,
    workspaceCreateProgressReceived,
  } from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-slice';

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

  const cloneProgressId = 'workspace-setup-card-live-clone';

  function setupLiveClone() {
    store.dispatch(beginWorkspaceCreateProgress(cloneProgressId));
    store.dispatch(
      workspaceCreateProgressReceived(cloneProgressId, {
        phase: 'receiving',
        percent: 42,
        message: 'Receiving objects: 60%',
        transfer: {
          receivedObjects: 612_000,
          totalObjects: 1_020_000,
          receivedBytes: 123_400_000,
          bytesPerSecond: 5_700_000,
        },
      }),
    );
    return () => store.dispatch(clearWorkspaceCreateProgress(cloneProgressId));
  }

  export const preview = definePreview<Props>({
    id: 'workspace-setup-card',
    title: 'Workspace setup card',
    defaultState: 'ready',
    states: {
      starting: {
        props: { ...base, repoStatus: 'active', branchStatus: 'active', agentStatus: 'active' },
      },
      'live-clone': {
        props: {
          ...base,
          repoStatus: 'active',
          branchStatus: 'pending',
          agentStatus: 'pending',
          progressId: cloneProgressId,
        },
        setup: setupLiveClone,
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
