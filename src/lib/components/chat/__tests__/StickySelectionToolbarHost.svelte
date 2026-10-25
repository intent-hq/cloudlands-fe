<script lang="ts">
  import { onDestroy, type ComponentProps } from 'svelte';
  import { setupChatChangesPreview } from '../../../../test/chat-changes-preview';
  import ChatChangesPanelHarness from '../ChatChangesPanelHarness.svelte';

  let props: ComponentProps<typeof ChatChangesPanelHarness> = $props();
  // Read owners must run before the panel mounts and requests its diffs.
  onDestroy(setupChatChangesPreview());
</script>

<ChatChangesPanelHarness {...props} />
