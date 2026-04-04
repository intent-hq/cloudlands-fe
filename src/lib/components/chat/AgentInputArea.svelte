<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { TooltipShortcut } from '$lib/components/ui/tooltip';
  import Fa from 'svelte-fa';
  import { faStop, faPaperPlane, faPlus } from '@fortawesome/free-solid-svg-icons';
  import type { AgentSession } from '$features/agent/agent-ipc-bridge';
  import type { Workspace } from '$shared/types';
  import SimpleRichInput from '$lib/components/chat/input/SimpleRichInput.svelte';
  import { isFocusInTerminal } from '$lib/utils/keyboardShortcuts';

  interface Props {
    session?: AgentSession | null;
    isProcessing?: boolean;
    isStreaming?: boolean;
    disabled?: boolean;
    placeholder?: string;
    showStopButton?: boolean;
    showNewChatButton?: boolean;
    contextReferences?: any[];
    enableShortcuts?: boolean;
    workspace?: Workspace | null;
    onSend?: (detail: { content: string; contextReferences?: any[] }) => void;
    onStop?: () => void;
    onNewChat?: () => void;
    onFilesAttach?: (detail: { files: File[] }) => void;
    onContextUpdate?: (detail: { references: any[] }) => void;
  }

  let {
    session = null,
    isProcessing = false,
    isStreaming = false,
    disabled = false,
    placeholder = 'Type a message...',
    showStopButton = false,
    showNewChatButton = false,
    contextReferences = [],
    enableShortcuts = true,
    workspace = null,
    onSend,
    onStop,
    onNewChat,
    onFilesAttach,
    onContextUpdate,
  }: Props = $props();

  // State
  let inputComponent: any = $state();
  let currentMessage = $state('');
  let isSending = $state(false);

  // PERF: Memoized computed values
  // Allow sending with just context references (no text required)
  const canSend = $derived(
    !disabled && !isProcessing && (currentMessage.trim().length > 0 || contextReferences.length > 0),
  );
  const inputDisabled = $derived(disabled || isProcessing);

  // Methods
  export async function focus(): Promise<boolean> {
    if (inputComponent?.focus) {
      return await inputComponent.focus();
    }
    return false;
  }

  export function clear() {
    currentMessage = '';
    if (inputComponent?.clear) {
      inputComponent.clear();
    }
  }

  export function setValue(value: string) {
    currentMessage = value;
    if (inputComponent?.setValue) {
      inputComponent.setValue(value);
    }
  }

  // Event handlers
  function handleSend() {
    if (!canSend || isSending) return;

    const message = currentMessage.trim();
    // Allow sending with just context references (no text required)
    if (!message && contextReferences.length === 0) return;

    isSending = true;
    onSend?.({
      content: message,
      contextReferences: contextReferences.length > 0 ? contextReferences : undefined,
    });

    // Clear input after sending
    clear();

    // Reset sending flag after a short delay
    setTimeout(() => {
      isSending = false;
    }, 100);
  }

  function handleStop() {
    onStop?.();
  }

  function handleNewChat() {
    onNewChat?.();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (!enableShortcuts) return;

    // Cmd/Ctrl + Enter to send
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      handleSend();
    }

    // Escape to stop streaming
    if (event.key === 'Escape' && isStreaming) {
      event.preventDefault();
      handleStop();
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length > 0) {
      onFilesAttach?.({ files });
    }
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
  }

  // Lifecycle
  onMount(() => {
    // Focus input on mount, but not if a terminal already has focus
    setTimeout(() => {
      if (!isFocusInTerminal()) {
        focus();
      }
    }, 100);

    // Add global keyboard listener
    window.addEventListener('keydown', handleKeyDown);
  });

  onDestroy(() => {
    // Remove global keyboard listener
    window.removeEventListener('keydown', handleKeyDown);
  });
</script>

<div
  class="flex flex-col gap-2 p-4 bg-background border-t border-border"
  role="group"
  aria-label="Chat input area and context references"
  ondrop={handleDrop}
  ondragover={handleDragOver}
>
  {#if contextReferences.length > 0}
    <div class="flex flex-wrap gap-2 py-2">
      {#each contextReferences as ref, refIndex (`ref-${refIndex}-${ref.id || ref.name || ref.type}`)}
        <div
          class="flex items-center gap-1 px-2 py-1 bg-muted border border-border rounded-full text-sm"
        >
          <span>{ref.name || ref.type || 'Context'}</span>
          <button
            class="flex items-center justify-center size-4 p-0 bg-transparent border-none text-muted-foreground cursor-pointer transition-colors hover:text-destructive-foreground"
            onclick={() => {
              const newRefs = contextReferences.filter((r) => r !== ref);
              onContextUpdate?.({ references: newRefs });
            }}
          >
            ×
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="flex gap-2 items-end [&_.chat-input]:flex-1">
    <SimpleRichInput
      bind:this={inputComponent}
      bind:value={currentMessage}
      {placeholder}
      disabled={inputDisabled}
      {workspace}
      onsubmit={handleSend}
    />

    <div class="flex gap-1">
      {#if showStopButton && (isProcessing || isStreaming)}
        <TooltipShortcut label="Stop generation" shortcut="esc" side="top" delayDuration={200}>
          <Button variant="ghost" size="sm" onclick={handleStop}>
            <Fa icon={faStop} />
          </Button>
        </TooltipShortcut>
      {:else if canSend}
        <TooltipShortcut label="Send message" shortcut="cmd+enter" side="top" delayDuration={200}>
          <Button variant="ghost" size="sm" onclick={handleSend}>
            <Fa icon={faPaperPlane} />
          </Button>
        </TooltipShortcut>
      {/if}

      {#if showNewChatButton && session}
        <TooltipShortcut label="Start new chat" side="top" delayDuration={200}>
          <Button variant="ghost" size="sm" onclick={handleNewChat}>
            <Fa icon={faPlus} />
          </Button>
        </TooltipShortcut>
      {/if}
    </div>
  </div>

  {#if isProcessing && !isStreaming}
    <div class="flex justify-center gap-1 p-2">
      <span class="size-2 bg-primary rounded-full animate-bounce-dot"></span>
      <span class="size-2 bg-primary rounded-full animate-bounce-dot" style="animation-delay: 0.2s"
      ></span>
      <span class="size-2 bg-primary rounded-full animate-bounce-dot" style="animation-delay: 0.4s"
      ></span>
    </div>
  {/if}
</div>

<style>
  @keyframes bounce-dot {
    0%,
    80%,
    100% {
      transform: translateY(0) scale(0.8);
      opacity: 0.4;
    }
    40% {
      transform: translateY(-4px) scale(1);
      opacity: 1;
    }
  }

  .animate-bounce-dot {
    animation: bounce-dot 1.4s ease-in-out infinite;
  }
</style>
