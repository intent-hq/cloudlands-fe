<script lang="ts">
  import { onMount } from 'svelte';
  import Toast from '$lib/components/ui/toast/Toast.svelte';
  import { notify } from '$lib/components/patterns/notify';
  import DesktopConsentCard from './DesktopConsentCard.svelte';
  import { request } from './desktop-test-fixtures';
  let decision = $state('');
  onMount(() => {
    const id = notify.custom(DesktopConsentCard, {
      duration: Infinity,
      dismissible: false,
      componentProps: { request, onDecision: (value: string) => (decision = value) },
    });
    return () => {
      notify.dismiss(id);
    };
  });
</script>

<!-- i18n-ignore (component test fixture) -->
<div class="min-h-screen bg-background text-foreground">
  <output aria-label="Decision">{decision}</output>
  <Toast />
</div>
