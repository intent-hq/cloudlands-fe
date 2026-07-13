<script lang="ts">
  export let selectedModel: string | undefined = undefined;
  export let providerId: string | undefined = undefined;
  export let isLocked: boolean = false;
  export let lockedTitle: string | undefined = undefined;
  export let showLockIconWhenLocked: boolean = true;
  export let deferUpdate: boolean = false;
  export let onModelChange: ((model: string) => void) | undefined = undefined;
  export let workspaceId: string | undefined = undefined;
  export let agentId: string | undefined = undefined;
  export let portal: boolean = false;
  export let updateGlobalStore: boolean = false;
  export let variant: string | undefined = undefined;
  export let size: string | undefined = undefined;

  export function open() {}
  export function clearFallbackWarning() {}
  export function clearPendingUpdate() {}

  function handleTriggerModelChange() {
    const input = document.querySelector('[data-testid="model-picker-trigger-input"]') as HTMLInputElement;
    if (input && onModelChange) {
      onModelChange(input.value);
    }
  }
</script>

<div
  data-testid="model-picker"
  data-locked={isLocked ? 'true' : 'false'}
  data-show-lock-icon={showLockIconWhenLocked ? 'true' : 'false'}
  title={lockedTitle}
>
  <span data-testid="model-picker-provider">{providerId}</span>
  <span data-testid="model-picker-model">{selectedModel}</span>
  <input data-testid="model-picker-trigger-input" type="hidden" />
  <button data-testid="model-picker-trigger" on:click={handleTriggerModelChange}>Change Model</button>
</div>