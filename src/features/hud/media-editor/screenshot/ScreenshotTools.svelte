<script lang="ts">
  import { screenshotKindLabel } from './screenshot-labels';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import CursorClickIcon from 'phosphor-svelte/lib/CursorClickIcon';
  import RectangleIcon from 'phosphor-svelte/lib/RectangleIcon';
  import ScribbleIcon from 'phosphor-svelte/lib/ScribbleIcon';
  import ArrowUpRightIcon from 'phosphor-svelte/lib/ArrowUpRightIcon';
  import TextTIcon from 'phosphor-svelte/lib/TextTIcon';
  import DropIcon from 'phosphor-svelte/lib/DropIcon';
  import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
  import type { ScreenshotTool } from './ScreenshotCanvas.svelte';
  let {
    tool,
    disabled = false,
    canDelete = false,
    onSelect,
    onDelete,
  }: {
    tool: ScreenshotTool;
    disabled?: boolean;
    canDelete?: boolean;
    onSelect: (tool: ScreenshotTool) => void;
    onDelete: () => void;
  } = $props();
  // No pointer button: with no tool chosen, marks are selected and moved directly.
  // Clicking the chosen tool again (or Esc) goes back to that.
  const tools = [
    { id: 'element', label: screenshotKindLabel('element'), icon: CursorClickIcon },
    { id: 'box', label: screenshotKindLabel('box'), icon: RectangleIcon },
    { id: 'draw', label: screenshotKindLabel('draw'), icon: ScribbleIcon },
    { id: 'arrow', label: screenshotKindLabel('arrow'), icon: ArrowUpRightIcon },
    { id: 'text', label: screenshotKindLabel('text'), icon: TextTIcon },
    { id: 'blur', label: screenshotKindLabel('blur'), icon: DropIcon },
  ] as const;
</script>

<div class="tools" role="group" aria-label={m.dock_screenshotEditor_tools()}>
  {#each tools as item}
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={item.label}
      tooltip={item.label}
      aria-pressed={tool === item.id}
      active={tool === item.id}
      {disabled}
      onclick={() => onSelect(tool === item.id ? 'pointer' : item.id)}
      ><item.icon size={18} /></Button
    >
  {/each}
  <span class="separator" aria-hidden="true"></span>
  <Button
    variant="ghost"
    size="icon-sm"
    aria-label={m.dock_screenshotEditor_deleteSelected()}
    tooltip={m.dock_screenshotEditor_deleteSelected()}
    disabled={disabled || !canDelete}
    onclick={onDelete}><TrashIcon size={18} /></Button
  >
</div>

<style>
  .tools {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-medium);
    background: hsl(var(--background));
  }
  .separator {
    height: 1px;
    align-self: stretch;
    background: hsl(var(--border));
    margin-block: 4px;
  }
</style>
