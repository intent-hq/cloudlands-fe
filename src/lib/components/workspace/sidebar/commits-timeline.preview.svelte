<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { CommitInfo } from '$features/file-tracking/types';
  import { store as appStore } from '$store/renderer/store';
  import {
    appendOlderCommits,
    clearWorkspace,
    setCommitsData,
    setLoadingOlderCommits,
  } from '$store/renderer/slices/changes/changes-slice';

  const workspaceId = 'preview-commits-timeline';
  const commit: CommitInfo = {
    hash: 'a'.repeat(40),
    message:
      'fix: keep long commit metadata readable in the workspace sidebar without clipping actions',
    author: 'Preview Author',
    timestamp: 1787486400000,
    stage: 'local',
    isPushed: false,
    files: [{ path: 'src/preview.ts', additions: 12, deletions: 3 }],
  };

  function setup(expanded = false, loading = false) {
    appStore.dispatch(setCommitsData(workspaceId, [commit], 'b'.repeat(40)));
    if (expanded) {
      appStore.dispatch(
        appendOlderCommits(workspaceId, [
          {
            ...commit,
            hash: 'c'.repeat(40),
            message: 'Previous commit with a long title that should stay within the sidebar',
            stage: 'pushed',
            isPushed: true,
          },
        ]),
      );
    }
    appStore.dispatch(setLoadingOlderCommits(workspaceId, loading));
    return () => appStore.dispatch(clearWorkspace(workspaceId));
  }

  export const preview = definePreview<{ width: number }>({
    id: 'commits-timeline',
    title: 'Sidebar commits',
    defaultState: 'collapsed',
    states: {
      collapsed: { props: { width: 320 }, setup: () => setup() },
      expanded: { props: { width: 320 }, setup: () => setup(true) },
      loading: { props: { width: 320 }, setup: () => setup(false, true) },
      narrow: { props: { width: 248 }, setup: () => setup(true) },
    },
  });
</script>

<script lang="ts">
  import CommitsTimeline from './CommitsTimeline.svelte';
  let { width }: { width: number } = $props();
</script>

<section
  class="min-h-64 overflow-auto rounded-lg border border-border bg-sidebar p-3 text-foreground"
  style:width={`${width}px`}
  data-commits-timeline-preview
>
  <CommitsTimeline {workspaceId} />
</section>
