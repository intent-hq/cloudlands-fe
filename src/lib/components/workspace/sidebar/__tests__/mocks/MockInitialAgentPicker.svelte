<script lang="ts">
  interface Props {
    selectedSpecialist?: string | null;
    selectedModel?: string;
    modelWasOverridden?: boolean;
    isTeamMode?: boolean;
    onModelChange?: (model: string | undefined) => void;
  }

  let {
    selectedSpecialist = $bindable<string | null>('spec-writer'),
    selectedModel,
    modelWasOverridden = $bindable(false),
    isTeamMode = $bindable(true),
    onModelChange,
  }: Props = $props();
</script>

<div data-testid="mock-initial-agent-picker">
  <span>{selectedSpecialist ?? 'general'}</span>
  <span>{selectedModel ?? 'default-model'}</span>
  <span>{String(modelWasOverridden)}</span>
  <span>{String(isTeamMode)}</span>
  <button
    type="button"
    onclick={() => {
      selectedSpecialist = 'ui-designer';
      isTeamMode = false;
      modelWasOverridden = true;
      onModelChange?.('claude-sonnet-4-20250514');
    }}
  >
    Mock agent change
  </button>
</div>
