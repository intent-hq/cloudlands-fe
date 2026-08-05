<script lang="ts">
  /**
   * Minimal composer stand-in for the draft-manager harness: a plain
   * textarea bound to `value`, plus a `setContent` instance method mirroring
   * SimpleRichInput's editor-hydration entry point (which also feeds the
   * value binding via the editor's onUpdate).
   */
  let {
    value = $bindable(''),
    disabled = false,
  }: {
    value?: string;
    disabled?: boolean;
  } = $props();

  export function setContent(text: string) {
    value = text;
  }
</script>

<textarea data-testid="mock-composer" bind:value {disabled}></textarea>
