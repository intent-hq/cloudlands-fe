<script lang="ts">
  import { onMount } from 'svelte';
  import Toast from '$lib/components/ui/toast/Toast.svelte';
  import { notify } from '$lib/components/patterns/notify';
  import DesktopConsentCard from './DesktopConsentCard.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { request } from './desktop-test-fixtures';
  interface Props {
    claimsPrimary?: boolean;
    missingPermissions?: boolean;
  }
  let { claimsPrimary = false, missingPermissions = false }: Props = $props();
  let decision = $state('');
  onMount(() => {
    const id = notify.custom(DesktopConsentCard, {
      duration: Infinity,
      dismissible: false,
      componentProps: {
        request: {
          ...request,
          computerName: missingPermissions ? 'MacBook' : request.computerName,
          claimsPrimary,
        },
        guidance: missingPermissions
          ? [
              m.desktop_os_accessibility_description(),
              m.desktop_os_screenRecording_description(),
              m.desktop_os_setup_description(),
            ].join(' ')
          : undefined,
        onDecision: (value: string) => (decision = value),
      },
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
