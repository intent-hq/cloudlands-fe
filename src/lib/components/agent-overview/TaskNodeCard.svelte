<script lang="ts">
  /**
   * TaskNodeCard Component
   *
   * Card for displaying a task in the force-directed graph.
   * Shows task name and completion state with a checkbox-style icon.
   * Includes a play button to run an agent on the task.
   */
  import type { TaskNode } from './types';
  import { faCheck, faCircle, faSpinner, faBan, faPlay } from '@fortawesome/free-solid-svg-icons';
  import { faSquare, faCheckSquare, faSquareMinus } from '@fortawesome/free-regular-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    node: TaskNode;
    isActive?: boolean;
    /** Whether the task is currently being accessed by a streaming agent */
    isBeingAccessed?: boolean;
    actionType?: 'read' | 'write' | null;
    onclick?: () => void;
    onRunAgent?: () => void;
  }

  let { node, isActive = false, isBeingAccessed = false, actionType = null, onclick, onRunAgent }: Props = $props();

  // Show play button only for not started tasks
  const showPlayButton = $derived(node.state === 'not_started' && onRunAgent);

  // Handle play button click (stop propagation to prevent triggering the card's onclick)
  function handlePlayClick(e: MouseEvent) {
    e.stopPropagation();
    onRunAgent?.();
  }

  // Icon based on task state
  const stateIcon = $derived.by(() => {
    switch (node.state) {
      case 'complete':
        return faCheckSquare;
      case 'in_progress':
        return faSquareMinus;
      case 'cancelled':
        return faBan;
      default:
        return faSquare;
    }
  });

  // Color based on state
  const stateColor = $derived.by(() => {
    switch (node.state) {
      case 'complete':
        return 'text-green-500';
      case 'in_progress':
        return 'text-blue-500';
      case 'cancelled':
        return 'text-muted-foreground/50';
      default:
        return 'text-muted-foreground/70';
    }
  });

  // Glow class for active access
  const glowClass = $derived(isBeingAccessed ? 'task-glow-active' : '');
</script>

<div
  class="task-node-card group flex items-center gap-2 px-2.5 py-2 rounded-md border border-border shadow-xs transition-all duration-200 cursor-pointer
    bg-muted/30 hover:bg-muted/50
    {isActive ? 'ring-1 ring-primary/30' : ''} {glowClass}"
  role="button"
  tabindex="0"
  onclick={onclick}
  onkeydown={(e) => e.key === 'Enter' && onclick?.()}
>
  <!-- Checkbox icon -->
  <span class="{stateColor} shrink-0">
    <Fa icon={stateIcon} size="sm" />
  </span>

  <!-- Task info -->
  <div class="flex-1 min-w-0 flex flex-col">
    <!-- Task name -->
    <p class="text-xs font-medium text-foreground truncate {node.state === 'complete' ? 'line-through opacity-60' : ''}">
      {node.name}
    </p>
  </div>

  <!-- Play button - run agent on task -->
  {#if showPlayButton}
    <button
      type="button"
      class="play-button shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground"
      title="Run agent on task"
      onclick={handlePlayClick}
    >
      <Fa icon={faPlay} size="xs" />
    </button>
  {/if}
</div>

<style>
  .task-node-card {
    backdrop-filter: blur(4px);
    min-width: 30px;
    max-width: 180px;
  }

  /* Glowing gradient animation for tasks being accessed */
  .task-glow-active {
    position: relative;
    box-shadow: 0 0 12px 2px rgba(139, 92, 246, 0.3);
    animation: task-glow-pulse 2s ease-in-out infinite;
  }

  .task-glow-active::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(
      135deg,
      rgba(139, 92, 246, 0.6) 0%,
      rgba(167, 139, 250, 0.4) 25%,
      rgba(139, 92, 246, 0.6) 50%,
      rgba(167, 139, 250, 0.4) 75%,
      rgba(139, 92, 246, 0.6) 100%
    );
    background-size: 200% 200%;
    animation: task-gradient-shift 2s linear infinite;
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

  @keyframes task-glow-pulse {
    0%,
    100% {
      box-shadow: 0 0 12px 2px rgba(139, 92, 246, 0.3);
    }
    50% {
      box-shadow: 0 0 20px 4px rgba(139, 92, 246, 0.5);
    }
  }

  @keyframes task-gradient-shift {
    0% {
      background-position: 0% 50%;
    }
    100% {
      background-position: 200% 50%;
    }
  }
</style>
