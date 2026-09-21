<script lang="ts">
  let {
    selectedModel,
    defaultModelId,
    onModelChange,
    showReasoning = false,
    reasoningEffort,
    onReasoningChange,
  }: {
    selectedModel?: string;
    defaultModelId?: string;
    onModelChange?: (
      model: string | undefined,
      pick?: { providerId: string; modelId: string },
    ) => void;
    showReasoning?: boolean;
    reasoningEffort?: string | null;
    onReasoningChange?: (effort: string | null) => boolean | void | Promise<boolean | void>;
  } = $props();
</script>

<div data-testid="mock-model-picker">
  <span data-testid="picker-selected">{selectedModel ?? ''}</span>
  <span data-testid="picker-default">{defaultModelId ?? ''}</span>
  <span data-testid="picker-show-reasoning">{showReasoning ? 'true' : 'false'}</span>
  <span data-testid="picker-reasoning">{reasoningEffort ?? ''}</span>
  <button
    type="button"
    data-testid="pick-model"
    onclick={() => onModelChange?.('user-picked-model')}
  >
    pick
  </button>
  <button
    type="button"
    data-testid="pick-cross-provider-model"
    onclick={() => onModelChange?.('codex:cross-provider-model')}
  >
    pick cross-provider model
  </button>
  <button type="button" data-testid="pick-default" onclick={() => onModelChange?.('')}>
    pick default
  </button>
  <button
    type="button"
    data-testid="pick-model-with-triple"
    onclick={() =>
      onModelChange?.('bare-picked-model', { providerId: 'codex', modelId: 'bare-picked-model' })}
  >
    pick model with resolved triple
  </button>
  {#if showReasoning}
    <button type="button" data-testid="pick-reasoning" onclick={() => onReasoningChange?.('high')}>
      pick reasoning
    </button>
    <button type="button" data-testid="clear-reasoning" onclick={() => onReasoningChange?.(null)}>
      clear reasoning
    </button>
  {/if}
</div>
