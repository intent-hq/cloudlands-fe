<script lang="ts">
  /**
   * Minimal edit-mode input stand-in: exposes the `onsubmit` / `oncancel`
   * callbacks as buttons so tests can drive the save/cancel flow without the
   * real SimpleRichInput dependency tree (ModelPicker → useAgentSession needs
   * live store context).
   */
  let {
    value = $bindable(''),
    inputLocked = false,
    isStreaming = false,
    isResponding = false,
    onsubmit,
    oncancel,
    onstop,
    onvaluechange,
  }: {
    value?: string;
    inputLocked?: boolean;
    isStreaming?: boolean;
    isResponding?: boolean;
    onsubmit?: (value: string) => void;
    oncancel?: () => void;
    onstop?: () => void;
    onvaluechange?: (value: string) => void;
    [key: string]: unknown;
  } = $props();

  export function clear() {
    value = '';
    onvaluechange?.(value);
  }

  export async function setContent(text: string) {
    value = text;
    onvaluechange?.(value);
  }
</script>

<div data-testid="mock-rich-input" data-value={value} data-input-locked={inputLocked}>
  <input
    data-testid="mock-rich-input-editor"
    {value}
    oninput={(event) => {
      value = event.currentTarget.value;
      onvaluechange?.(value);
    }}
  />
  <button type="button" data-testid="mock-input-submit" onclick={() => onsubmit?.(value)}>
    submit
  </button>
  <button type="button" data-testid="mock-input-cancel" onclick={() => oncancel?.()}>
    cancel
  </button>
  {#if isStreaming || isResponding}
    <button type="button" data-testid="mock-input-stop" onclick={() => onstop?.()}>stop</button>
  {/if}
</div>
