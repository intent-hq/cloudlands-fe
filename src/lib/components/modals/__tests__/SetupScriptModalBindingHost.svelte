<script lang="ts">
  import SetupScriptModal from '../SetupScriptModal.svelte';

  let { onClose }: { onClose?: () => void } = $props();

  let open = $state(true);
  let value = $state('echo one');
</script>

<SetupScriptModal bind:open bind:value scriptName="One" {onClose}>
  {#snippet editor(current, setValue)}
    <button type="button" data-testid="edit-script" onclick={() => setValue('echo two')}>
      {current}
    </button>
  {/snippet}
</SetupScriptModal>

<output aria-label="bound script value">{value}</output>
<output aria-label="dialog state">{open ? 'open' : 'closed'}</output>
