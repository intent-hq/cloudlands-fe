<script lang="ts">
  import type { Snippet } from 'svelte';
  import CaptureEditorToolbar from '../CaptureEditorToolbar.svelte';
  import { screenshotKindLabel } from './screenshot-labels';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import RectangleIcon from 'phosphor-svelte/lib/RectangleIcon';
  import ScribbleIcon from 'phosphor-svelte/lib/ScribbleIcon';
  import ArrowUpRightIcon from 'phosphor-svelte/lib/ArrowUpRightIcon';
  import TextTIcon from 'phosphor-svelte/lib/TextTIcon';
  import DropIcon from 'phosphor-svelte/lib/DropIcon';
  import CursorIcon from 'phosphor-svelte/lib/CursorIcon';
  import type { ScreenshotTool } from './ScreenshotCanvas.svelte';
  let {
    tool,
    disabled = false,
    canBlur = true,
    onSelect,
    children,
  }: {
    tool: ScreenshotTool;
    disabled?: boolean;
    canBlur?: boolean;
    onSelect: (tool: ScreenshotTool) => void;
    children?: Snippet;
  } = $props();
  // Pointer selects and moves marks; clicking a drawing tool again also returns to it.
  const tools = [
    { id: 'pointer', label: screenshotKindLabel('pointer'), icon: CursorIcon },
    { id: 'box', label: screenshotKindLabel('box'), icon: RectangleIcon },
    { id: 'draw', label: screenshotKindLabel('draw'), icon: ScribbleIcon },
    { id: 'arrow', label: screenshotKindLabel('arrow'), icon: ArrowUpRightIcon },
    { id: 'text', label: screenshotKindLabel('text'), icon: TextTIcon },
    { id: 'blur', label: screenshotKindLabel('blur'), icon: DropIcon },
  ] as const;
</script>

<CaptureEditorToolbar label={m.dock_screenshotEditor_tools()}>
  {#each tools as item}
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={item.label}
      tooltip={item.label}
      aria-pressed={tool === item.id}
      active={tool === item.id}
      disabled={disabled || (item.id === 'blur' && !canBlur)}
      onclick={() => onSelect(tool === item.id ? 'pointer' : item.id)}
      ><item.icon size={18} /></Button
    >
  {/each}
  {#if children}
    <span class="capture-tool-separator" aria-hidden="true"></span>
    {@render children()}
  {/if}
</CaptureEditorToolbar>
