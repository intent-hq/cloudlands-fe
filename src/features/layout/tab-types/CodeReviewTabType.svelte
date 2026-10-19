<script lang="ts">
  /**
   * Code Review Tab Type Component
   *
   * Renders the code review interface.
   */

  import type { TabTypeComponentProps } from './registry';
  import { store as appStore } from '$store/renderer/store';
  import {
    changesConsumerMounted,
    changesConsumerUnmounted,
  } from '$store/renderer/slices/changes/changes-slice';
  import { CodeReviewTabContent } from '$lib/components/code-review';

  let { workspaceId, isActive }: TabTypeComponentProps = $props();
  $effect(() => {
    const wsId = workspaceId;
    if (!isActive || !wsId) return;
    appStore.dispatch(changesConsumerMounted(wsId, 'files'));
    return () => appStore.dispatch(changesConsumerUnmounted(wsId, 'files'));
  });
</script>

<CodeReviewTabContent {workspaceId} />
