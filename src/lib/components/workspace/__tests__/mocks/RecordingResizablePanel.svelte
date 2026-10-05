<script lang="ts" module>
  import type { Component } from 'svelte';

  /**
   * Test wrapper: records every props object a host passes to ResizablePanel,
   * then delegates rendering to the real component so DOM assertions still
   * observe production output. The test's `vi.mock` factory installs the
   * real component into `actualResizablePanel` before the first render.
   */
  export const actualResizablePanel: { component: Component<any> | null } = { component: null };
  export const recordedResizablePanelProps: Array<Record<string, unknown>> = [];
</script>

<script lang="ts">
  const { children, ...rest }: any = $props();
  // svelte-ignore state_referenced_locally
  recordedResizablePanelProps.push({ ...rest });
  const Actual = actualResizablePanel.component;
</script>

{#if Actual}
  <Actual {...rest}>
    {#if children}{@render children()}{/if}
  </Actual>
{/if}
