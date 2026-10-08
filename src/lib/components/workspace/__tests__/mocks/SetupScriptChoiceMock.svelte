<script lang="ts">
  import type { SetupScriptNameSource } from '$features/setup-scripts';
  let {
    open = $bindable(false),
    value = $bindable(''),
    scriptName = $bindable(''),
    scriptNameSource = $bindable<SetupScriptNameSource>('custom'),
    isCustomScript = $bindable(false),
    onCommit,
    onClose,
  }: {
    open?: boolean;
    value?: string;
    scriptName?: string;
    scriptNameSource?: SetupScriptNameSource;
    isCustomScript?: boolean;
    onCommit?: () => void;
    onClose?: () => void;
  } = $props();
  function choose(next: string) {
    value = next;
    scriptName = 'Custom';
    scriptNameSource = 'custom';
    isCustomScript = true;
    onCommit?.();
    open = false;
    onClose?.();
  }
</script>

{#if open}
  <button data-testid="choose-custom" onclick={() => choose('echo explicit')}>Custom</button>
  <button data-testid="choose-empty" onclick={() => choose('')}>Empty</button>
{/if}
