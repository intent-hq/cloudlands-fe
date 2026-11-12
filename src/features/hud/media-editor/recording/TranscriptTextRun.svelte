<script lang="ts">
  import { onDestroy } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { DockMediaTranscript } from '$shared/dock-media-edit';
  import { transcriptText, transcriptTextChange } from './transcript-text-edit';

  let {
    words,
    wordEdits,
    locked = false,
    onChange,
    onComposing,
    onSubmit,
  }: {
    words: readonly DockMediaTranscript['words'][number][];
    wordEdits: Readonly<Record<string, string>>;
    locked?: boolean;
    onChange: (changes: Record<string, string | null>) => void;
    onComposing: (composing: boolean) => void;
    onSubmit?: () => void;
  } = $props();
  let composing = false;
  let rejected = $state(false);
  const limitMessageId = $props.id();
  const text = $derived(transcriptText(words, wordEdits));

  // Let the browser own selection, caret and native text Undo. Parent echoes of an
  // input must not replace its DOM. Only external draft changes replace the text.
  function syncText(node: HTMLElement, value: string) {
    const sync = (next: string) => {
      if (!composing && node.innerText !== next) node.textContent = next;
    };
    sync(value);
    return { update: sync };
  }
  function input(event: Event): void {
    if (locked || composing) return;
    const node = event.currentTarget as HTMLElement;
    const changes = transcriptTextChange(words, wordEdits, node.innerText);
    if (Object.keys(changes).length) {
      rejected = false;
      onChange(changes);
    } else if (node.innerText !== text) {
      node.textContent = text;
      rejected = true;
    }
  }
  function beforeInput(event: InputEvent): void {
    const node = event.currentTarget as HTMLElement;
    const selection = window.getSelection();
    // Browser text hosts bound selections at annotation anchors. Defensively reject
    // any cross-host mutation as well. Numbers retain their own explicit Delete and transaction Undo.
    if (
      locked ||
      (selection && (!node.contains(selection.anchorNode) || !node.contains(selection.focusNode)))
    )
      event.preventDefault();
  }
  onDestroy(() => {
    if (composing) onComposing(false);
  });
</script>

<span
  class="transcript-text"
  data-transcript-text
  contenteditable="plaintext-only"
  role="textbox"
  aria-label={m.dock_captureEditor_voiceTranscript_label()}
  aria-multiline="true"
  aria-readonly={locked}
  aria-describedby={rejected ? limitMessageId : undefined}
  tabindex="0"
  use:syncText={text}
  onbeforeinput={beforeInput}
  oninput={input}
  oncompositionstart={() => {
    composing = true;
    onComposing(true);
  }}
  oncompositionend={(event) => {
    composing = false;
    input(event);
    onComposing(false);
  }}
  onkeydown={(event) => {
    if (composing || event.isComposing) {
      event.stopPropagation();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      (event.currentTarget as HTMLElement).blur();
    } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (!locked) onSubmit?.();
    } else if (event.key === 'Delete' || event.key === 'Backspace') event.stopPropagation();
  }}
></span>
{#if rejected}
  <span id={limitMessageId} class="text-limit" role="alert">
    {m.home_workspaceLabel_error_tooLong({ max: 20_000 })}
  </span>
{/if}

<style>
  .transcript-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    cursor: text;
    outline: none;
  }
  .transcript-text:focus-visible {
    text-decoration-color: hsl(var(--primary));
  }
  .transcript-text:empty::after {
    content: '\200b';
  }
  .text-limit {
    color: hsl(var(--danger));
  }
</style>
