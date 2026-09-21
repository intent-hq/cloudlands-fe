<script lang="ts">
  import type { TabTypeComponentProps } from '$features/layout/tab-types/registry';

  let { tab, isActive }: TabTypeComponentProps = $props();
</script>

<div data-testid="async-panel-content" data-active={isActive}>{tab.title}</div>
