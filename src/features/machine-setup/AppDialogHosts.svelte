<!--
  App-wide dialog hosts, mounted once in the app layout: the Set up a new
  machine wizard, then the confirm host (so its prompts open above the wizard),
  then the in-app file dialog host (Intent OS file choosers, above both).
-->
<script lang="ts">
  import { ConfirmHost } from '$lib/components/patterns/confirm';
  import InAppFileDialogHost from '$features/file-dialogs/InAppFileDialogHost.svelte';
  import MachineSetupWizard from './MachineSetupWizard.svelte';
</script>

<MachineSetupWizard />
<ConfirmHost />
<InAppFileDialogHost />
