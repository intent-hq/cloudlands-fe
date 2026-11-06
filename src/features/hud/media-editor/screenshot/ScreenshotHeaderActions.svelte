<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import CropIcon from 'phosphor-svelte/lib/CropIcon';
  let {
    cropping = false,
    disabled = false,
    onCrop,
    onApplyCrop,
    canApplyCrop = true,
  }: {
    cropping?: boolean;
    disabled?: boolean;
    onCrop: () => void;
    onApplyCrop?: () => void;
    canApplyCrop?: boolean;
  } = $props();
</script>

<div class="actions">
  <div class="crop-actions" role="group" aria-label={m.dock_screenshotEditor_crop()}>
    {#if cropping}
      <Button
        size="compact"
        disabled={disabled || !canApplyCrop || !onApplyCrop}
        onclick={() => onApplyCrop?.()}
        ><CropIcon size={16} />{m.dock_screenshotEditor_applyCrop()}</Button
      >
      <Button variant="ghost" size="compact" disabled={disabled} onclick={onCrop}
        >{m.dock_screenshotEditor_cancelCrop()}</Button
      >
    {:else}
      <Button
        variant="ghost"
        size="compact"
        aria-pressed={false}
        disabled={disabled}
        onclick={onCrop}><CropIcon size={16} />{m.dock_screenshotEditor_crop()}</Button
      >
    {/if}
  </div>
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
