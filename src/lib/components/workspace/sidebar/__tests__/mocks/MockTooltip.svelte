<script lang="ts">
  let { children, content, disabled, delayDuration }: any = $props();
  void content;
  // Expose the lazy prop getters to tests that simulate the real Tooltip
  // re-reading props mid-teardown (intent-hq/monorepo#2543).
  (globalThis as { __mockTooltipProps?: unknown[] }).__mockTooltipProps?.push({
    get content() {
      return content;
    },
    get disabled() {
      return disabled;
    },
    get delayDuration() {
      return delayDuration;
    },
  });
</script>

{#if children}{@render children()}{/if}
