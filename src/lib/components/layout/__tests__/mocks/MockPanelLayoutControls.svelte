<script lang="ts">
  /**
   * Minimal PanelLayoutControls stand-in: exposes a single button that invokes
   * `onApplyPreset('agents-row')` so tests can drive WindowTitleBar's
   * handleApplyPreset without the real dropdown/minimap dependency tree.
   */
  let { onApplyPreset }: { onApplyPreset?: (presetId: string) => void } = $props();
</script>

<button
  type="button"
  data-testid="mock-apply-agents-row"
  onclick={() => onApplyPreset?.('agents-row')}
>
  Apply agents-row
</button>
