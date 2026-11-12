<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';
  import { m } from '$shared/paraglide/messages.js';
  import type { SuggestionDetails } from './Suggestion';

  interface Props {
    suggestion: SuggestionDetails | null;
    anchor: HTMLElement | null;
    onAccept?: (id: string) => void;
    onReject?: (id: string) => void;
    onClose?: () => void;
  }

  let { suggestion, anchor, onAccept, onReject, onClose }: Props = $props();

  const typeLabel = $derived.by(() => {
    switch (suggestion?.type) {
      case 'addition':
        return m.tiptap_suggestionTooltip_addition_label();
      case 'deletion':
        return m.tiptap_suggestionTooltip_deletion_label();
      case 'modification':
        return m.tiptap_suggestionTooltip_modification_label();
      default:
        return m.tiptap_suggestionTooltip_suggestion_label();
    }
  });
</script>

<Popover.Root
  open={suggestion !== null && anchor !== null}
  onOpenChange={(open) => {
    if (!open) onClose?.();
  }}
>
  <Popover.Content
    customAnchor={anchor}
    side="top"
    align="start"
    preventScroll={false}
    class="flex w-max max-w-72 min-w-56 flex-col gap-1 p-3"
    data-suggestion-popover
    onOpenAutoFocus={(event) => event.preventDefault()}
    onCloseAutoFocus={(event) => event.preventDefault()}
  >
    {#if suggestion}
      {@const id = suggestion.id}
      <div class="flex min-w-0 items-baseline gap-2">
        <span class="shrink-0 font-medium text-foreground">{typeLabel}</span>
        {#if suggestion.author}
          <span class="truncate text-muted-foreground">
            {m.tiptap_suggestionTooltip_byAuthor_label({ author: suggestion.author })}
          </span>
        {/if}
      </div>
      {#if suggestion.reason}
        <p class="text-muted-foreground">{suggestion.reason}</p>
      {/if}
      {#if suggestion.originalText && suggestion.type === 'modification'}
        <p class="min-w-0 break-words text-foreground">
          <span class="text-muted-foreground">{m.tiptap_suggestionTooltip_original_label()}</span>
          {suggestion.originalText}
        </p>
      {/if}
      <div class="mt-2 flex justify-end gap-1">
        <Button variant="ghost" size="sm" onclick={() => onReject?.(id)}>
          {m.tiptap_suggestionTooltip_reject_label()}
        </Button>
        <Button variant="secondary" size="sm" onclick={() => onAccept?.(id)}>
          {m.tiptap_suggestionTooltip_accept_label()}
        </Button>
      </div>
    {/if}
  </Popover.Content>
</Popover.Root>
