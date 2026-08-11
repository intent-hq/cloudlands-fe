<script lang="ts">
  export let value = '';
  export let placeholder = '';
  export let disabled = false;
  export let onUpdate: ((value: string) => void) | undefined;

  export function focus() {}
  export function getInlineImages() {
    return [];
  }
  // Records mention insertions on a window-scoped array so tests can assert
  // path-reference chips (e.g. the oversized-attachment placement flow).
  export function insertMention(attrs: Record<string, unknown>): boolean {
    const target = window as unknown as { __tiptapInsertMentionCalls?: unknown[] };
    (target.__tiptapInsertMentionCalls ??= []).push(attrs);
    return true;
  }
</script>

<textarea
  data-testid="tiptap-editor"
  {value}
  {placeholder}
  {disabled}
  oninput={(event) => onUpdate?.((event.currentTarget as HTMLTextAreaElement).value)}
></textarea>