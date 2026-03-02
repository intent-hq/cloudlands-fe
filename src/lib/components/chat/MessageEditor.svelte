<!--
  MessageEditor.svelte

  Inline message editor for user messages.
  Allows editing the message text and regenerating from that point.
-->
<script lang="ts">
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Button from '$lib/components/ui/button/button.svelte';
  import Fa from 'svelte-fa';
  import { faCheck, faXmark } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    initialText: string;
    onSave: (text: string) => void;
    onCancel: () => void;
    class?: string;
  }

  let { initialText, onSave, onCancel, class: className = '' }: Props = $props();

  let text = $state(initialText);
  let textareaRef = $state<HTMLTextAreaElement | null>(null);

  // Focus and select all on mount
  $effect(() => {
    if (textareaRef) {
      textareaRef.focus();
      textareaRef.select();
    }
  });

  // Auto-resize textarea
  $effect(() => {
    if (textareaRef) {
      textareaRef.style.height = 'auto';
      textareaRef.style.height = `${textareaRef.scrollHeight}px`;
    }
  });

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  }

  function handleSave() {
    const trimmed = text.trim();
    if (trimmed && trimmed !== initialText.trim()) {
      onSave(trimmed);
    } else {
      onCancel();
    }
  }
</script>

<div
  class="flex flex-col gap-2 {className}"
  in:fade={{ duration: 150, easing: cubicOut }}
  out:fade={{ duration: 100, easing: cubicOut }}
>
  <textarea
    bind:this={textareaRef}
    bind:value={text}
    onkeydown={handleKeyDown}
    class="w-full min-h-10 max-h-48 px-3 py-2.5 text-sm leading-normal text-foreground bg-background border border-border rounded-lg resize-none overflow-y-auto focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
    rows="1"
    placeholder="Edit your message..."
    autocorrect="off"
    autocapitalize="off"
    spellcheck="false"
  ></textarea>

  <div class="flex justify-end gap-2">
    <Button variant="ghost" size="sm" onclick={onCancel} class="text-subtle">
      <Fa icon={faXmark} class="mr-1.5" />
      Cancel
    </Button>
    <Button variant="default" size="sm" onclick={handleSave} disabled={!text.trim()}>
      <Fa icon={faCheck} class="mr-1.5" />
      Send
    </Button>
  </div>

  <p class="text-ui text-subtle text-right">
    Press <kbd
      class="inline-flex items-center justify-center min-w-5 px-1 py-0.5 text-ui font-medium bg-muted border border-border rounded mx-0.5"
      >⌘</kbd
    ><kbd
      class="inline-flex items-center justify-center min-w-5 px-1 py-0.5 text-ui font-medium bg-muted border border-border rounded mx-0.5"
      >↵</kbd
    >
    to send,
    <kbd
      class="inline-flex items-center justify-center min-w-5 px-1 py-0.5 text-ui font-medium bg-muted border border-border rounded mx-0.5"
      >Esc</kbd
    > to cancel
  </p>
</div>
