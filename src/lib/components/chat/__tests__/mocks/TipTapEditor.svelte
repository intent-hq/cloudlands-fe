<script lang="ts">
  export let value = '';
  export let placeholder = '';
  export let disabled = false;
  export let onUpdate: ((value: string) => void) | undefined;

  export function focus() {}
  export function getInlineImages() {
    return [];
  }
</script>

<textarea
  data-testid="tiptap-editor"
  {value}
  {placeholder}
  {disabled}
  oninput={(event) => onUpdate?.((event.currentTarget as HTMLTextAreaElement).value)}
></textarea>