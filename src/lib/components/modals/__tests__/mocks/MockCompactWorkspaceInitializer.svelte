<script lang="ts">
  let { isExpanded = $bindable(true) }: { isExpanded?: boolean } = $props();

  export function applyPrefill() {}
  export function focusAndSelectAll() {}
</script>

<div data-testid="mock-initializer" data-expanded={isExpanded}></div>
