<script lang="ts">
  let {
    selectedModel,
    defaultModelId,
    onModelChange,
  }: {
    selectedModel?: string;
    defaultModelId?: string;
    onModelChange?: (model: string | undefined) => void;
  } = $props();
</script>

<div data-testid="mock-model-picker">
  <span data-testid="picker-selected">{selectedModel ?? ''}</span>
  <span data-testid="picker-default">{defaultModelId ?? ''}</span>
  <button type="button" data-testid="pick-model" onclick={() => onModelChange?.('user-picked-model')}>
    pick
  </button>
</div>
