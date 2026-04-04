<script lang="ts">
  import { onMount } from 'svelte';
  import {
    faCommentDots,
    faCodePullRequest,
    faSquarePen,
    faCircleQuestion,
  } from '@fortawesome/free-solid-svg-icons';
  import Portal from '$lib/components/ui/Portal.svelte';

  interface Props {
    x: number;
    y: number;
    onSubmit?: (event: CustomEvent<{ content: string; type: string }>) => void;
    onClose?: () => void;
  }

  let { x = 0, y = 0, onSubmit, onClose }: Props = $props();

  let content = $state('');
  let commentType: 'comment' | 'suggestion' | 'change-request' | 'question' = $state('comment');
  let containerRef: HTMLDivElement | null = $state(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const typeOptions = [
    { value: 'comment', label: 'Comment', icon: faCommentDots },
    { value: 'suggestion', label: 'Suggestion', icon: faCodePullRequest },
    { value: 'change-request', label: 'Change Request', icon: faSquarePen },
    { value: 'question', label: 'Question', icon: faCircleQuestion },
  ];

  function handleSubmit() {
    if (content.trim()) {
      onSubmit?.(
        new CustomEvent('submit', {
          detail: { content: content.trim(), type: commentType },
        }),
      );
      content = '';
      commentType = 'comment';
    }
  }

  function handleClose() {
    content = '';
    commentType = 'comment';
    onClose?.();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClose();
    } else if (e.key === 'Enter' && e.ctrlKey) {
      handleSubmit();
    }
  }

  onMount(() => {
    // Focus the textarea when dialog opens
    const textarea = containerRef?.querySelector('textarea');
    if (textarea) {
      textarea.focus();
    }
  });
</script>

<!-- Render through portal to avoid clipping -->
<Portal>
  <!-- Comment Dialog -->
  <div
    bind:this={containerRef}
    class="fixed z-[15] bg-card rounded-lg shadow-lg border border-border p-3 w-80 animate-in fade-in slide-in-from-top-2 duration-200"
    style="left: {x}px; top: {y}px; transform: translateX(20px);"
  >
    <!-- Content Textarea -->
    <div class="mb-3">
      <textarea
        bind:value={content}
        placeholder="Add a comment..."
        onkeydown={handleKeyDown}
        class="w-full p-2 text-xs rounded bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-300 dark:focus:ring-slate-600 resize-none border-0"
        rows="3"
      ></textarea>
    </div>

    <!-- Actions -->
    {#if content.trim()}
      <div class="flex gap-2">
        <button
          onclick={handleSubmit}
          class="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Send
        </button>
        <button
          onclick={handleClose}
          class="text-xs px-2 py-1 rounded text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          Cancel
        </button>
      </div>
    {/if}
  </div>

  <!-- Backdrop - click outside to close -->
  <button class="fixed inset-0 z-[14]" onclick={handleClose} aria-label="Close dialog" type="button"
  ></button>
</Portal>

<style>
  :global(.comment-dialog-backdrop) {
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
