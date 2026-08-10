<script lang="ts">
  /**
   * Minimal composer stand-in for the draft-manager harness: a plain
   * textarea bound to `value`, plus a `setContent` instance method mirroring
   * SimpleRichInput's editor-hydration entry point (which also feeds the
   * value binding via the editor's onUpdate).
   *
   * `inputLocked` mirrors SimpleRichInput's editor-only lock: typing and focus
   * are rejected, but the control keeps its enabled styling and placeholder.
   */
  let {
    value = $bindable(''),
    disabled = false,
    inputLocked = false,
    placeholder = 'Type a message',
  }: {
    value?: string;
    disabled?: boolean;
    inputLocked?: boolean;
    placeholder?: string;
  } = $props();

  export function setContent(text: string) {
    value = text;
  }

  export function focus(): boolean {
    if (inputLocked || disabled) return false;
    return true;
  }
</script>

<textarea data-testid="mock-composer" bind:value {disabled} {placeholder} readonly={inputLocked}
></textarea>
