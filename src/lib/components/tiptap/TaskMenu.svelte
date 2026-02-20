<script lang="ts">
  import { logger } from '$lib/utils/client-logger';

  /**
   * TaskMenu Component - Modern Popover API Implementation
   *
   * This component uses two cutting-edge web APIs for optimal UX:
   *
   * 1. **Popover API** (Chrome 114+, Firefox 125+, Safari 17+):
   *    - Native browser popover with automatic focus management
   *    - Built-in light dismiss (outside click, Escape key)
   *    - Top layer rendering (no z-index issues)
   *    - Screen reader accessibility out of the box
   *
   * 2. **CSS Anchor Positioning** (Chrome 125+, Firefox 131+, Safari 17.4+):
   *    - Declarative positioning relative to anchor elements
   *    - Automatic fallback positioning when clipped
   *    - Works across DOM boundaries with position: fixed
   *    - Browser handles viewport constraints natively
   *
   * Architecture:
   * - Task button (in TipTap editor) has `popovertarget="task-menu-xyz"`
   * - This component has matching `id="task-menu-xyz"` and `popover="auto"`
   * - CSS anchor positioning connects them: `position-anchor: --anchor-name`
   *
   * Benefits over manual positioning:
   * - No JavaScript calculations needed
   * - Automatic accessibility features
   * - Consistent behavior across browsers
   * - Future-proof modern web standards
   */
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faRobot, faList } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    id: string; // Must match popovertarget attribute on trigger button
    anchorName?: string; // CSS anchor name for positioning
    onSelectAction: (action: string) => void;
  }

  let { id, anchorName = undefined, onSelectAction }: Props = $props();

  let popoverElement: HTMLElement | undefined = $state(undefined);

  function handleAction(action: string) {
    onSelectAction(action);
    // Popover will close automatically, but we can also close it explicitly
    popoverElement?.hidePopover();
  }

  onMount(() => {
    // Listen for popover toggle events if needed
    const handleToggle = (event: Event) => {
      logger.info('Popover toggled:', event);
    };
    popoverElement?.addEventListener('toggle', handleToggle);

    return () => {
      popoverElement?.removeEventListener('toggle', handleToggle);
    };
  });
</script>

<div
  bind:this={popoverElement}
  {id}
  popover="auto"
  class="task-menu-popover"
  class:anchored={anchorName}
  style={anchorName ? `position-anchor: --${anchorName};` : ''}
>
  <button class="task-menu-item" onclick={() => handleAction('assign-agent')}>
    <Fa icon={faRobot} size="sm" class="w-4 h-4" />
    <span>Assign to agent</span>
  </button>

  <button class="task-menu-item" onclick={() => handleAction('task-breakdown')}>
    <Fa icon={faList} size="sm" class="w-4 h-4" />
    <span>Break task into subtasks</span>
  </button>
</div>

<style>
  /*
   * CSS Anchor Positioning Implementation
   *
   * This uses the modern CSS Anchor Positioning API to position the popover
   * relative to the task menu button, even across DOM boundaries.
   *
   * How it works:
   * 1. Task button sets: anchor-name: --task-menu-anchor-xyz
   * 2. This popover sets: position-anchor: --task-menu-anchor-xyz
   * 3. Browser automatically positions popover relative to button
   * 4. Fallbacks handle edge cases (viewport constraints, clipping)
   *
   * Fallback Strategy:
   * - Primary: Right side, top-aligned (user preference)
   * - Fallback 1: Right side, below button
   * - Fallback 2: Left side, top-aligned
   * - Fallback 3: Left side, below button
   * - Fallback 4: Centered below button (last resort)
   */

  .task-menu-popover {
    /* Popover base styles - browser handles positioning in top layer */
    min-width: 12rem;
    background: hsl(var(--popover));
    border: 1px solid hsl(var(--border));
    border-radius: 0.5rem;
    padding: 0.25rem;
    box-shadow:
      0 4px 6px -1px rgb(0 0 0 / 0.1),
      0 2px 4px -2px rgb(0 0 0 / 0.1);
    /* Remove default popover styles */
    margin: 0;
  }

  .task-menu-popover.anchored {
    /*
     * CSS Anchor Positioning - connects to button's anchor-name
     * position: fixed allows positioning relative to viewport anchor
     */
    position: fixed;
    left: anchor(right); /* Primary: Right side of button */
    top: anchor(top); /* Primary: Top-aligned with button */
    margin-left: 0.5rem; /* Small gap from button */
    position-try-fallbacks: --try-right-bottom, --try-left-top, --try-left-bottom, --try-center;
  }

  @position-try --try-right-bottom {
    left: anchor(right);
    top: anchor(bottom);
    margin-left: 0.5rem;
    margin-top: 0.5rem;
  }

  @position-try --try-left-top {
    left: anchor(left);
    top: anchor(top);
    margin-left: -12rem;
    margin-top: 0;
  }

  @position-try --try-left-bottom {
    left: anchor(left);
    top: anchor(bottom);
    margin-left: -12rem;
    margin-top: 0.5rem;
  }

  @position-try --try-center {
    left: anchor(center);
    top: anchor(bottom);
    margin-left: -6rem; /* Half the menu width to center it */
    margin-top: 0.5rem;
  }

  .task-menu-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: none;
    background: transparent;
    color: hsl(var(--foreground));
    font-size: 0.875rem;
    text-align: left;
    border-radius: 0.375rem;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .task-menu-item:hover {
    background: hsl(var(--accent));
  }

  .task-menu-item:active {
    background: hsl(var(--accent) / 0.8);
  }
</style>
