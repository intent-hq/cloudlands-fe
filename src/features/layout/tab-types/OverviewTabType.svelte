<script lang="ts">
  /**
   * Overview Tab Type Component
   *
   * Placeholder for overview panel - not yet implemented.
   */

  import type { TabTypeComponentProps } from './registry';

  let { tab }: TabTypeComponentProps = $props();
</script>

<div class="flex flex-col items-center justify-center h-full text-subtle gap-4">
  <div class="text-center">
    <p class="text-lg font-medium text-foreground">{tab.title}</p>
    <p class="text-sm">Type: {tab.type}</p>
    <p class="text-xs mt-4 text-subtle">Overview panel not yet implemented</p>
  </div>
</div>
