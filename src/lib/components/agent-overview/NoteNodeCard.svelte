<script lang="ts">
  import { faNote } from '$lib/icons/faNote';
  /**
   * NoteNodeCard Component
   *
   * Card for displaying a note in the force-directed graph.
   * Styled similarly to AgentCard with border and shadow.
   */
  import type { NoteNode } from './types';
  import { faStickyNote, faPen, faEye } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    node: NoteNode;
    isActive?: boolean;
    /** Whether the note is currently being accessed (read/write) by a streaming agent */
    isBeingAccessed?: boolean;
    actionType?: 'read' | 'write' | null;
    onclick?: () => void;
  }

  let { node, isActive = false, isBeingAccessed = false, actionType = null, onclick }: Props = $props();

  // Action indicator icon
  const actionIcon = $derived.by(() => {
    if (node.lastAction === 'write') return faPen;
    if (node.lastAction === 'read') return faEye;
    return null;
  });

  // Glow class for active access
  const glowClass = $derived(isBeingAccessed ? 'note-glow-active' : '');
</script>

<button
  type="button"
  class="note-node-card flex items-center gap-2 px-2.5 py-2 rounded-md border border-border shadow-xs transition-all duration-200 cursor-pointer
    bg-muted/30 hover:bg-muted/50
    {isActive ? 'ring-1 ring-primary/30' : ''} {glowClass}"
  {onclick}
>
  <!-- Icon -->
  <span class="text-subtle shrink-0">
    <Fa icon={faNote} size="sm" />
  </span>

  <!-- Note info -->
  <div class="flex-1 min-w-0 flex flex-col">
    <!-- Note title -->
    <p class="text-xs font-medium text-foreground truncate">
      {node.title}
    </p>
  </div>
</button>

<style>
  .note-node-card {
    backdrop-filter: blur(4px);
    min-width: 30px;
    max-width: 180px;
  }

  /* Glowing gradient animation for notes being accessed */
  .note-glow-active {
    position: relative;
    box-shadow: 0 0 12px 2px rgba(147, 51, 234, 0.3);
    animation: note-glow-pulse 2s ease-in-out infinite;
  }

  .note-glow-active::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(
      135deg,
      rgba(147, 51, 234, 0.6) 0%,
      rgba(192, 132, 252, 0.4) 25%,
      rgba(147, 51, 234, 0.6) 50%,
      rgba(192, 132, 252, 0.4) 75%,
      rgba(147, 51, 234, 0.6) 100%
    );
    background-size: 200% 200%;
    animation: note-gradient-shift 2s linear infinite;
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

  @keyframes note-glow-pulse {
    0%,
    100% {
      box-shadow: 0 0 12px 2px rgba(147, 51, 234, 0.3);
    }
    50% {
      box-shadow: 0 0 20px 4px rgba(147, 51, 234, 0.5);
    }
  }

  @keyframes note-gradient-shift {
    0% {
      background-position: 0% 50%;
    }
    100% {
      background-position: 200% 50%;
    }
  }
</style>
