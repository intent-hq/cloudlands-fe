<script lang="ts">
  /**
   * Minimal edit-mode input stand-in: exposes the `onsubmit` / `oncancel`
   * callbacks as buttons so tests can drive the save/cancel flow without the
   * real SimpleRichInput dependency tree (ModelPicker → useAgentSession needs
   * live store context).
   */
  let {
    value = $bindable(''),
    onsubmit,
    oncancel,
  }: {
    value?: string;
    onsubmit?: () => void;
    oncancel?: () => void;
    [key: string]: unknown;
  } = $props();
</script>

<div data-testid="mock-rich-input" data-value={value}>
  <button type="button" data-testid="mock-input-submit" onclick={() => onsubmit?.()}>
    submit
  </button>
  <button type="button" data-testid="mock-input-cancel" onclick={() => oncancel?.()}>
    cancel
  </button>
</div>
