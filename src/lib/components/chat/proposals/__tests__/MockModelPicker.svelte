<script lang="ts">
  // Stands in for the New Workspace ModelPicker: shows the props the card
  // passes and fires the same pick callbacks.
  interface Props {
    selectedModel?: string | null;
    providerId?: string;
    reasoningEffort?: string | null;
    isLocked?: boolean;
    onModelChange?: (model: string, pick?: { providerId: string; modelId: string }) => void;
    onReasoningChange?: (effort: string | null) => boolean | void;
  }
  let {
    selectedModel,
    providerId,
    reasoningEffort,
    isLocked = false,
    onModelChange,
    onReasoningChange,
  }: Props = $props();
</script>

<div
  data-testid="mock-model-picker"
  data-provider={providerId ?? ''}
  data-model={selectedModel ?? ''}
  data-effort={reasoningEffort ?? ''}
  data-locked={String(isLocked)}
>
  <button
    type="button"
    onclick={() => onModelChange?.('gpt-5.5', { providerId: 'codex', modelId: 'gpt-5.5' })}
    >Mock pick Codex model</button
  >
  <button
    type="button"
    onclick={() =>
      onModelChange?.('claude-code:claude-opus-4-5', {
        providerId: 'claude-code',
        modelId: 'claude-opus-4-5',
      })}>Mock pick Claude model</button
  >
  <button type="button" onclick={() => onReasoningChange?.('high')}>Mock pick high effort</button>
</div>
