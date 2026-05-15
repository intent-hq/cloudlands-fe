<script lang="ts">
  /**
   * WalkthroughCommentThread
   *
   * A clean inline annotation card matching the goal design.
   * Features:
   * - Simple flat card with lightbulb icon, message, timestamp, close button
   * - Expandable "Suggested changes" section if needed
   * - Text input for asking questions
   */
  import {
  slide,
  fly,
} from 'svelte/transition';
  import Fa from 'svelte-fa';
  import {
  faPaperPlane,
  faSpinner,
  faComment,
  faUser,
  faChevronDown,
  faChevronUp,
  faLightbulb,
  faInfoCircle,
  faExclamationCircle,
  faTimes,
} from '@fortawesome/free-solid-svg-icons';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import type { WalkthroughAnnotation } from './types';

  interface ThreadMessage {
    id: string;
    type: 'annotation' | 'user' | 'agent';
    content: string;
    timestamp?: Date;
  }

  interface Props {
    /** The annotation that started this thread */
    annotation: WalkthroughAnnotation;
    /** Line number for context */
    lineNumber: number;
    /** File path for context */
    fileName: string;
    /** Additional messages in the thread (user messages and agent responses) */
    messages?: ThreadMessage[];
    /** Callback when sending a message */
    onSendMessage?: (message: string, lineNumber: number, fileName: string) => void;
    /** Callback to close/dismiss the thread */
    onClose?: () => void;
    /** Whether a message is being sent */
    isSending?: boolean;
    /** Whether an agent response is pending */
    isAgentResponding?: boolean;
    /** Timestamp for display */
    timestamp?: Date;
    class?: string;
  }

  let {
    annotation,
    lineNumber,
    fileName,
    messages = [],
    onSendMessage,
    onClose,
    isSending = false,
    isAgentResponding = false,
    timestamp,
    class: className = '',
  }: Props = $props();

  let replyText = $state('');
  let showReplyInput = $state(false);
  let showSuggestedChanges = $state(false);
  let inputElement = $state<HTMLInputElement | null>(null);

  // Auto-focus input when shown
  $effect(() => {
    if (showReplyInput && inputElement) {
      inputElement.focus();
    }
  });

  function handleSend() {
    if (!replyText.trim() || isSending) return;
    onSendMessage?.(replyText.trim(), lineNumber, fileName);
    replyText = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      if (replyText) {
        replyText = '';
      } else {
        showReplyInput = false;
      }
    }
  }

  // Get annotation type icon
  function getAnnotationIcon(type: string) {
    switch (type) {
      case 'highlight':
        return faExclamationCircle;
      case 'context':
        return faInfoCircle;
      case 'explanation':
      default:
        return faLightbulb;
    }
  }

  // Get annotation icon color
  function getAnnotationIconColor(type: string): string {
    switch (type) {
      case 'highlight':
        return 'text-orange-500';
      case 'context':
        return 'text-blue-500';
      case 'explanation':
      default:
        return 'text-amber-500';
    }
  }

  // Format timestamp
  function formatTime(date?: Date): string {
    if (!date) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Check if there's any conversation beyond the initial annotation
  const hasConversation = $derived(messages.length > 0);
</script>

<!-- Simple annotation card matching goal design -->
<div
  class="walkthrough-comment-thread relative flex w-full flex-col bg-white shadow-sm dark:bg-slate-900 {className}"
  transition:slide={{ duration: 150 }}
>
  <!-- Main annotation content - single row layout -->
  <div class="flex items-start gap-3 px-4 py-3">
    <!-- Yellow/amber lightbulb icon -->
    <div class="shrink-0 mt-0.5">
      <Fa icon={getAnnotationIcon(annotation.type)} class="h-4 w-4 {getAnnotationIconColor(annotation.type)}" />
    </div>

    <!-- Message content -->
    <div class="flex-1 min-w-0">
      <div class="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
        <MarkdownViewer
          content={annotation.message}
          className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        />
      </div>
      {#if timestamp}
        <div class="text-xs text-slate-400 dark:text-slate-500 mt-1">
          {formatTime(timestamp)}
        </div>
      {/if}
    </div>

    <!-- Close button -->
    {#if onClose}
      <button
        type="button"
        onclick={onClose}
        class="shrink-0 p-1 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 transition-colors"
        title="Dismiss"
      >
        <Fa icon={faTimes} class="h-3.5 w-3.5" />
      </button>
    {/if}
  </div>

  <!-- Suggested changes section (collapsible) -->
  {#if hasConversation}
    <div class="border-t border-slate-200 dark:border-slate-700">
      <button
        type="button"
        onclick={() => showSuggestedChanges = !showSuggestedChanges}
        class="w-full flex items-center justify-between px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        <span class="font-medium">Suggested changes</span>
        <Fa icon={showSuggestedChanges ? faChevronUp : faChevronDown} class="h-3 w-3" />
      </button>

      {#if showSuggestedChanges}
        <div class="px-4 pb-3 divide-y divide-slate-100 dark:divide-slate-700" transition:slide={{ duration: 150 }}>
          {#each messages as msg, i (msg.id)}
            <div
              class="flex items-start gap-3 py-2"
              transition:fly={{ y: 4, duration: 150, delay: i * 30 }}
            >
              <div class="shrink-0 flex h-5 w-5 items-center justify-center rounded-full {msg.type === 'user' ? 'bg-blue-100 dark:bg-blue-900/50' : 'bg-purple-100 dark:bg-purple-900/50'}">
                <Fa
                  icon={msg.type === 'user' ? faUser : faSpinner}
                  class="h-2.5 w-2.5 {msg.type === 'user' ? 'text-blue-600 dark:text-blue-400' : 'text-purple-600 dark:text-purple-400'}"
                />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  <MarkdownViewer
                    content={msg.content}
                    className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                  />
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Agent responding indicator -->
  {#if isAgentResponding}
    <div class="flex items-center gap-2 px-4 py-2 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-700">
      <Fa icon={faSpinner} class="h-3 w-3 animate-spin" />
      <span>Agent is responding...</span>
    </div>
  {/if}

  <!-- Ask a question section -->
  <div class="border-t border-slate-200 dark:border-slate-700 px-4 py-2">
    {#if showReplyInput}
      <div class="flex items-center gap-2" transition:slide={{ duration: 100 }}>
        <input
          bind:this={inputElement}
          bind:value={replyText}
          onkeydown={handleKeydown}
          placeholder="Ask a follow-up question..."
          disabled={isSending}
          class="flex-1 h-8 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500/30 focus:border-blue-500/50 disabled:opacity-50"
        />
        <button
          type="button"
          onclick={handleSend}
          disabled={!replyText.trim() || isSending}
          class="h-8 w-8 flex items-center justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {#if isSending}
            <Fa icon={faSpinner} class="h-3.5 w-3.5 animate-spin" />
          {:else}
            <Fa icon={faPaperPlane} class="h-3 w-3" />
          {/if}
        </button>
        <button
          type="button"
          onclick={() => { showReplyInput = false; replyText = ''; }}
          class="h-8 px-2 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
        >
          Cancel
        </button>
      </div>
      <p class="text-ui text-slate-400 dark:text-slate-500 mt-1">Enter to send · Esc to cancel</p>
    {:else}
      <button
        type="button"
        onclick={() => (showReplyInput = true)}
        class="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
      >
        <Fa icon={faComment} class="h-3 w-3" />
        <span>Ask a question</span>
      </button>
    {/if}
  </div>
</div>
