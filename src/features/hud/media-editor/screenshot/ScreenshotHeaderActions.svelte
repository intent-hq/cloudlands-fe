<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import CropIcon from 'phosphor-svelte/lib/CropIcon';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
  let {
    cropping = false,
    retaking = false,
    disabled = false,
    onCrop,
    onRetake,
  }: {
    cropping?: boolean;
    retaking?: boolean;
    disabled?: boolean;
    onCrop: () => void;
    onRetake?: () => void;
  } = $props();
</script>

<div class="actions">
  <Button
    variant="ghost"
    size="compact"
    aria-pressed={cropping}
    disabled={disabled || retaking}
    onclick={onCrop}><CropIcon size={16} />{m.dock_screenshotEditor_crop()}</Button
  >
  {#if onRetake}<Button
      variant="ghost"
      size="compact"
      disabled={disabled || retaking}
      aria-busy={retaking}
      onclick={onRetake}
      ><ArrowsClockwiseIcon size={16} />{retaking
        ? m.dock_screenshotEditor_retaking()
        : m.dock_screenshotEditor_retake()}</Button
    >{/if}
</div>

<style>
  .actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
</style>
