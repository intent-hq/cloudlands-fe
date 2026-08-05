<script lang="ts">
  import Fa from 'svelte-fa';
  import {
  faCheck,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    suggestion: {
      id: string;
      type: 'addition' | 'deletion' | 'modification';
      author?: string;
      reason?: string;
      originalText?: string;
    };
    x?: number;
    y?: number;
    onAccept?: (id: string) => void;
    onReject?: (id: string) => void;
  }

  let { suggestion, x = 0, y = 0, onAccept, onReject }: Props = $props();

  function handleAccept() {
    onAccept?.(suggestion.id);
  }

  function handleReject() {
    onReject?.(suggestion.id);
  }

  function getTypeLabel(type: string) {
    switch (type) {
      case 'addition':
        return m.tiptap_suggestionTooltip_addition_label();
      case 'deletion':
        return m.tiptap_suggestionTooltip_deletion_label();
      case 'modification':
        return m.tiptap_suggestionTooltip_modification_label();
      default:
        return m.tiptap_suggestionTooltip_suggestion_label();
    }
  }
</script>

<div class="suggestion-tooltip" style="left: {x}px; top: {y}px;">
  <div class="flex justify-between items-center mb-2">
    <span class="font-semibold text-xs uppercase tracking-wide"
      >{getTypeLabel(suggestion.type)}</span
    >
    {#if suggestion.author}
      <span class="suggestion-tooltip-author">{m.tiptap_suggestionTooltip_byAuthor_label({ author: suggestion.author })}</span>
    {/if}
  </div>

  {#if suggestion.reason}
    <div class="suggestion-tooltip-reason">
      {suggestion.reason}
    </div>
  {/if}

  {#if suggestion.originalText && suggestion.type === 'modification'}
    <div class="mt-2 py-1 px-2 bg-muted rounded text-xs">
      <span class="font-semibold mr-1">{m.tiptap_suggestionTooltip_original_label()}</span>
      <span class="italic">{suggestion.originalText}</span>
    </div>
  {/if}

  <div class="suggestion-tooltip-actions">
    <button class="accept" onclick={handleAccept} title={m.tiptap_suggestionTooltip_accept_tooltip()}>
      <Fa icon={faCheck} size="xs" class="inline mr-1" />
      {m.tiptap_suggestionTooltip_accept_label()}
    </button>
    <button class="reject" onclick={handleReject} title={m.tiptap_suggestionTooltip_reject_tooltip()}>
      <Fa icon={faXmark} size="xs" class="inline mr-1" />
      {m.tiptap_suggestionTooltip_reject_label()}
    </button>
  </div>
</div>
