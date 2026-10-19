<script lang="ts">
  import InitialAgentPicker from '../../InitialAgentPicker.svelte';

  let selectedProvider = $state('auggie');
  let selectedModel = $state<string | undefined>();
  let modelWasOverridden = $state(false);
</script>

<InitialAgentPicker bind:selectedProvider bind:selectedModel bind:modelWasOverridden />
<output data-testid="selection"
  >{JSON.stringify({ selectedProvider, selectedModel, modelWasOverridden })}</output
>
