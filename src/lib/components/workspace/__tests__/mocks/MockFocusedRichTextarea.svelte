<script lang="ts">
  /**
   * RichTextarea stand-in that models the focused TipTap editor contract:
   * while the editor has focus (the New Space modal focuses it on open) an
   * external `value` change is ignored, so only the imperative `setContent`
   * changes what the user sees. Renders the visible editor text.
   */
  let {
    ariaLabel,
    value = $bindable(''),
  }: { ariaLabel: string; value?: string; disabled?: boolean } = $props();

  let shown = $state('');
  export function focus() {}
  export function focusAndSelectAll() {}
  export async function setContent(content: string) {
    shown = content;
    value = content;
  }
  export function clear() {
    shown = '';
    value = '';
  }
  export function insertText(_text: string) {}
  export function insertMention(_mention: unknown) {}
  export function insertContextMention(_mention: unknown) {}
  export function getContextMentions(): unknown[] {
    return [];
  }
  export function getMentions(): unknown[] {
    return [];
  }
  export function getInlineImages(): unknown[] {
    return [];
  }
</script>

<div aria-label={ariaLabel} role="textbox" data-testid="mock-rich-textarea">{shown}</div>
