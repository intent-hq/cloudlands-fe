<script lang="ts">
  /**
   * FileNodeCard Component
   *
   * Card for displaying a file in the force-directed graph.
   * Styled similarly to AgentCard with border and shadow.
   */
  import type { FileNode } from './types';
  import { faFile, faFileCode, faFileLines, faPen, faEye } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    node: FileNode;
    isActive?: boolean;
    /** Whether the file is currently being accessed (read/write) by a streaming agent */
    isBeingAccessed?: boolean;
    actionType?: 'read' | 'write' | null;
    onclick?: () => void;
  }

  let {
    node,
    isActive = false,
    isBeingAccessed = false,
    actionType = null,
    onclick,
  }: Props = $props();

  // Get file icon based on extension
  const fileIcon = $derived.by(() => {
    return faFile;
  });

  // Get parent directory for context
  const parentDir = $derived.by(() => {
    const parts = node.path.split('/');
    if (parts.length > 1) {
      return parts.slice(-2, -1)[0];
    }
    return '';
  });

  // Action indicator icon
  const actionIcon = $derived.by(() => {
    if (node.lastAction === 'write') return faPen;
    if (node.lastAction === 'read') return faEye;
    return null;
  });

  // Glow class for active access
  const glowClass = $derived(isBeingAccessed ? 'file-glow-active' : '');
</script>

<button
  type="button"
  class="file-node-card flex gap-2 px-2.5 py-2 rounded-md border border-border shadow-xs transition-all duration-200 cursor-pointer
    bg-muted/30 hover:bg-muted/50
    {isActive ? 'ring-1 ring-primary/30' : ''} {glowClass}"
  {onclick}
>
  <!-- Icon -->
  <span class="text-muted-foreground/50 shrink-0 mt-0.5">
    <Fa icon={fileIcon} size="sm" />
  </span>

  <!-- File info -->
  <div class="flex-1 min-w-0 flex items-baseline gap-1.5 text-left">
    <!-- File name -->
    <p class="text-xs font-medium text-foreground truncate">
      {node.fileName}
    </p>
    <!-- Parent directory -->
    {#if parentDir}
      <p class="text-xs text-muted-foreground truncate">
        {parentDir}
      </p>
    {/if}
  </div>
</button>

<style>
  .file-node-card {
    backdrop-filter: blur(4px);
    min-width: 120px;
    max-width: 180px;
  }

  /* Glowing gradient animation for files being accessed */
  .file-glow-active {
    position: relative;
    box-shadow: 0 0 12px 2px rgba(59, 130, 246, 0.3);
    animation: file-glow-pulse 2s ease-in-out infinite;
  }

  .file-glow-active::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(
      135deg,
      rgba(59, 130, 246, 0.2) 0%,
      rgba(147, 197, 253, 0.1) 25%,
      rgba(59, 130, 246, 0.2) 50%,
      rgba(147, 197, 253, 0.1) 75%,
      rgba(59, 130, 246, 0.2) 100%
    );
    background-size: 200% 200%;
    animation: file-gradient-shift 2s linear infinite;
    -webkit-mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
    z-index: 1;
  }

  @keyframes file-glow-pulse {
    0%,
    100% {
      box-shadow: 0 0 12px 2px rgba(59, 130, 246, 0.1);
    }
    50% {
      box-shadow: 0 0 20px 4px rgba(59, 130, 246, 0.13);
    }
  }

  @keyframes file-gradient-shift {
    0% {
      background-position: 0% 55%;
    }
    100% {
      background-position: 200% 55%;
    }
  }
</style>
