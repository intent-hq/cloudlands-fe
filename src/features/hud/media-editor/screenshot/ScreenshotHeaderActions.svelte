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
    onApplyCrop,
    canApplyCrop = true,
    onRetake,
  }: {
    cropping?: boolean;
    retaking?: boolean;
    disabled?: boolean;
    onCrop: () => void;
    onApplyCrop?: () => void;
    canApplyCrop?: boolean;
    onRetake?: () => void;
  } = $props();
</script>

<div class="actions">
  <div class="crop-actions" role="group" aria-label={m.dock_screenshotEditor_crop()}>
    {#if cropping}
      <Button
        size="compact"
        disabled={disabled || retaking || !canApplyCrop || !onApplyCrop}
        onclick={() => onApplyCrop?.()}
        ><CropIcon size={16} />{m.dock_screenshotEditor_applyCrop()}</Button
      >
      <Button variant="ghost" size="compact" disabled={disabled || retaking} onclick={onCrop}
        >{m.dock_screenshotEditor_cancelCrop()}</Button
      >
    {:else}
      <Button
        variant="ghost"
        size="compact"
        aria-pressed={false}
        disabled={disabled || retaking}
        onclick={onCrop}><CropIcon size={16} />{m.dock_screenshotEditor_crop()}</Button
      >
    {/if}
  </div>
  <Button
    variant="ghost"
    size="compact"
    disabled={disabled || retaking || !onRetake}
    tooltip={onRetake ? undefined : m.dock_screenshotEditor_retakeUnavailable()}
    aria-busy={retaking}
    onclick={() => onRetake?.()}
    ><ArrowsClockwiseIcon size={16} />{retaking
      ? m.dock_screenshotEditor_retaking()
      : m.dock_screenshotEditor_retake()}</Button
  >
</div>

<style>
  .actions,
  .crop-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
</style>
