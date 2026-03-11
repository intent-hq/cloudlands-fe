<script lang="ts">
  export let selectedModel: string | undefined = undefined;
  export let providerId: string | undefined = undefined;
  export let isLocked: boolean = false;
  export let lockedTitle: string | undefined = undefined;
  export let showLockIconWhenLocked: boolean = true;

  export function open() {}
  export function clearFallbackWarning() {}
</script>

<div
  data-testid="model-picker"
  data-locked={isLocked ? 'true' : 'false'}
  data-show-lock-icon={showLockIconWhenLocked ? 'true' : 'false'}
  title={lockedTitle}
>
  <span data-testid="model-picker-provider">{providerId}</span>
  <span data-testid="model-picker-model">{selectedModel}</span>
</div>