<script lang="ts">
  /**
   * Test stand-in for DirectoryPickerModal. Renders a single button while
   * open that reports a fixed user-picked path, so component tests can
   * simulate "user explicitly chose a clone destination" without driving
   * the real directory-listing store.
   */
  interface Props {
    open?: boolean;
    title?: string;
    initialPath?: string;
    selectLabel?: string;
    onSelect?: (path: string) => void;
    onClose?: () => void;
  }

  let { open = false, onSelect }: Props = $props();
</script>

{#if open}
  <button
    type="button"
    data-testid="mock-picker-select"
    onclick={() => onSelect?.('/Users/me/src')}
  >
    mock select
  </button>
{/if}
