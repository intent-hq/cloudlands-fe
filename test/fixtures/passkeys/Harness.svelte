<script lang="ts">
  import { onMount } from 'svelte';
  import PasskeyDialogHost from '../../../src/features/passkeys/PasskeyDialogHost.svelte';

  const guest = new URL(location.href).searchParams.get('guest') ?? 'about:blank';
  onMount(() => {
    (window as unknown as { passkeyFixture: boolean }).passkeyFixture = true;
  });
</script>

<div class="h-screen w-screen bg-background text-foreground">
  <webview src={guest} partition="persist:browser-panel" class="block h-full w-full"></webview>
  <PasskeyDialogHost />
</div>
