<script lang="ts">
  import { fade } from 'svelte/transition';
  import { faNote } from '$lib/icons/faNote';
  import Fa from 'svelte-fa';
  import {
    faFile,
    faFolder,
    faCheckSquare,
    faBook,
    faTerminal,
    faGlobe,
    faRobot,
    faUserTie,
  } from '@fortawesome/free-solid-svg-icons';
  import type { MentionCandidate, MentionType } from '$lib/services/mentions/types';

  interface Props {
    mention: MentionCandidate;
    position: { x: number; y: number };
    onClose?: () => void;
  }

  let { mention, position, onClose }: Props = $props();

  let hoverElement: HTMLDivElement | undefined = $state();

  // Map mention types to Font Awesome icons (partial - fallback to file icon)
  const typeIcons: Partial<Record<MentionType, typeof faFile>> = {
    file: faFile,
    'file-range': faFile,
    folder: faFolder,
    'source-folder': faFolder,
    note: faNote,
    'note-range': faNote,
    task: faCheckSquare,
    rule: faBook,
    command: faTerminal,
    'external-source': faGlobe,
    agent: faRobot,
    personality: faUserTie,
    workspace: faFolder,
    symbol: faFile,
  };

  function getIcon() {
    return typeIcons[mention.type] || faFile;
  }

  // Get the path to display (relative path preferred)
  function getDisplayPath(): string {
    const meta = mention.meta as Record<string, any> | undefined;
    return meta?.relativePath || meta?.fullPath || meta?.path || '';
  }

  function handleMouseOut(event: MouseEvent) {
    const relatedTarget = event.relatedTarget as HTMLElement;
    // Close if mouse leaves the preview and doesn't go to the pill
    if (!relatedTarget?.closest('[data-mention]')) {
      onClose?.();
    }
  }

  // Position the preview to avoid viewport edges
  function getAdjustedPosition() {
    const padding = 10;
    let { x, y } = position;

    // Adjust if too close to right edge (compact preview is ~250px)
    if (x + 250 > window.innerWidth) {
      x = window.innerWidth - 250 - padding;
    }

    // Adjust if too close to bottom (compact preview is ~30px)
    if (y + 30 > window.innerHeight) {
      y = position.y - 30 - padding;
    }

    return { x, y };
  }

  const adjustedPos = getAdjustedPosition();
  const displayPath = getDisplayPath();
</script>

<div
  bind:this={hoverElement}
  class="mention-hover-preview"
  style="left: {adjustedPos.x}px; top: {adjustedPos.y}px"
  transition:fade={{ duration: 150 }}
  role="tooltip"
  aria-label="Mention preview"
  onmouseout={handleMouseOut}
>
  <!-- Compact single-line format: icon + filename + path -->
  <div class="preview-content">
    <div class="preview-icon">
      <Fa icon={getIcon()} />
    </div>
    <div class="preview-text">
      <span class="filename">{mention.label}</span>
      {#if displayPath}
        <span class="path">{displayPath}</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .mention-hover-preview {
    position: fixed;
    z-index: 1000;
    background: hsl(var(--popover));
    border: 1px solid hsl(var(--border));
    border-radius: 0;
    padding: 2px 8px;
    max-width: 250px;
    min-width: 150px;
    height: 22px;
    display: flex;
    align-items: center;
  }

  .preview-content {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
  }

  .preview-icon {
    width: 8px;
    height: 8px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    color: hsl(var(--muted-foreground));
    opacity: 0.2;
  }

  .preview-text {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    flex: 1;
  }

  .filename {
    font-weight: 500;
    font-size: 12px;
    color: hsl(var(--foreground));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .path {
    font-size: 11px;
    color: hsl(var(--muted-foreground));
    opacity: 0.6;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
