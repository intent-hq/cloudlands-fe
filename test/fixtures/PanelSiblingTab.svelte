<script lang="ts">
  import type { TabTypeComponentProps } from '$features/layout/tab-types/registry';
  let { tab }: TabTypeComponentProps = $props();
</script>

<button type="button" data-testid="sibling-tab-content">{tab.title}</button>
