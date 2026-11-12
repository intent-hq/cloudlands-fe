<!--
  App-wide dialog hosts, mounted once in the app layout: the Set up a new
  machine wizard, then the confirm host (so its prompts open above the wizard).
-->
<script lang="ts">
  import { ConfirmHost } from '$lib/components/patterns/confirm';
  import MachineSetupWizard from './MachineSetupWizard.svelte';
</script>

<MachineSetupWizard />
<ConfirmHost />
