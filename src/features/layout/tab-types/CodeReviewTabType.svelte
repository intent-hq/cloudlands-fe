<script lang="ts">
  /**
   * Code Review Tab Type Component
   *
   * Renders the code review interface.
   */

  import type { TabTypeComponentProps } from './registry';
  import { CodeReviewTabContent } from '$lib/components/code-review';

  let { workspaceId }: TabTypeComponentProps = $props();
</script>

<CodeReviewTabContent {workspaceId} />
