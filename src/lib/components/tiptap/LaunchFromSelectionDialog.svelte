<script lang="ts">
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { faPaperPlane } from '@fortawesome/free-solid-svg-icons';
  import Portal from '$lib/components/ui/Portal.svelte';
  import type { Workspace } from '$shared/types';

  interface Props {
    x: number;
    y: number;
    workspace: Workspace;
    noteId?: string;
    initialMessage?: string;
    onSubmit?: (event: CustomEvent<{ userMessage: string }>) => void;
    onClose?: () => void;
  }

  // workspace and noteId are passed through but not used in this component
  // They're part of the Props interface for consistency with parent expectations
  let {
    x = 0,
    y = 0,
    workspace: _workspace,
    noteId: _noteId,
    initialMessage = '',
    onSubmit,
    onClose,
  }: Props = $props();

  let userMessage = $state(initialMessage);
  let textareaRef: HTMLTextAreaElement | null = $state(null);

  // Update userMessage when initialMessage prop changes
  $effect(() => {
    userMessage = initialMessage;
  });

  function handleSubmit() {
    // Allow submission even with empty message
    onSubmit?.(
      new CustomEvent('submit', {
        detail: { userMessage: userMessage.trim() },
      }),
    );
  }

  function handleClose() {
    onClose?.();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClose();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  onMount(() => {
    // Focus the textarea when dialog opens - use setTimeout to ensure DOM is ready after portal renders
    setTimeout(() => {
      textareaRef?.focus();
    }, 0);
  });

  // Calculate adjusted position to keep dialog in viewport
  let adjustedX = $derived.by(() => {
    const dialogWidth = 280;
    const padding = 12;
    // Center the dialog horizontally on x, clamped to viewport
    const centered = x - dialogWidth / 2;
    const maxX = (typeof window !== 'undefined' ? window.innerWidth : 1000) - dialogWidth - padding;
    return Math.max(padding, Math.min(centered, maxX));
  });
</script>

<!-- Render through portal to avoid clipping -->
<Portal>
  <!-- Backdrop - click outside to close -->
  <button
    class="fixed inset-0 z-50 bg-transparent"
    onclick={handleClose}
    aria-label="Close dialog"
    type="button"
  ></button>

  <!-- Compact floating popover - positioned below the bubble menu -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="launch-dialog fixed z-60"
    style="left: {adjustedX}px; top: {y}px;"
    onmousedown={(e) => e.stopPropagation()}
  >
    <div class="flex items-end gap-1.5">
      <textarea
        bind:this={textareaRef}
        bind:value={userMessage}
        placeholder="What should the agent do?"
        onkeydown={handleKeyDown}
        class="launch-textarea"
        rows="1"
      ></textarea>
      <button
        onclick={handleSubmit}
        class="launch-submit-btn"
        aria-label="Send to agent"
      >
        <Fa icon={faPaperPlane} size="xs" />
      </button>
    </div>
    <div class="launch-hint">
      Press <kbd>Enter</kbd> to send · <kbd>Esc</kbd> to cancel
    </div>
  </div>
</Portal>

<style>
  .launch-dialog {
    background-color: hsl(var(--popover));
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
    box-shadow:
      0 2px 4px hsl(var(--foreground) / 0.04),
      0 8px 24px hsl(var(--foreground) / 0.12);
    padding: 8px;
    width: 280px;
    animation: launchDialogIn 0.15s ease-out;
  }

  .launch-textarea {
    flex: 1;
    min-height: 32px;
    max-height: 120px;
    padding: 6px 10px;
    font-size: 13px;
    line-height: 1.4;
    color: hsl(var(--foreground));
    background-color: hsl(var(--muted) / 0.3);
    border: 1px solid transparent;
    border-radius: 6px;
    resize: none;
    outline: none;
    transition: all 0.15s ease;
    field-sizing: content;
  }

  .launch-textarea::placeholder {
    color: hsl(var(--muted-foreground) / 0.6);
  }

  .launch-textarea:focus {
    background-color: hsl(var(--background));
    border-color: hsl(var(--border));
  }

  .launch-submit-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    border: none;
    background-color: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .launch-submit-btn:hover {
    background-color: hsl(var(--primary) / 0.9);
    transform: scale(1.02);
  }

  .launch-submit-btn:active {
    transform: scale(0.98);
  }

  .launch-hint {
    margin-top: 6px;
    font-size: 11px;
    color: hsl(var(--muted-foreground) / 0.5);
    text-align: center;
  }

  .launch-hint kbd {
    display: inline-block;
    padding: 1px 4px;
    font-size: 11px;
    font-family: inherit;
    background-color: hsl(var(--muted) / 0.5);
    border-radius: 3px;
  }

  @keyframes launchDialogIn {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>
