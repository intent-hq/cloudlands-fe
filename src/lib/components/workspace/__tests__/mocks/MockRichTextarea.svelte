<script lang="ts">
  /**
   * Minimal RichTextarea stand-in for CompactWorkspaceInitializer tests.
   * Exposes the imperative surface the initializer calls via bind:this.
   */
  let {
    ariaLabel,
    value = $bindable(''),
    disabled = false,
  }: { ariaLabel: string; value?: string; disabled?: boolean } = $props();

  let element: HTMLDivElement;
  export function focus() {
    element?.focus();
  }
  export function focusAndSelectAll() {
    element?.focus();
  }
  export async function setContent(content: string) {
    value = content;
  }
  export function clear() {
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

<div
  bind:this={element}
  aria-label={ariaLabel}
  role="textbox"
  data-testid="mock-rich-textarea"
  data-disabled={disabled}
>
  {value}
</div>
