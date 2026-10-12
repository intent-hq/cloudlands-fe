<script lang="ts" module>
  // Presentation-only session memory survives shell remounts and host reconnects.
  const shown = new Set<string>();
  export function resetProviderCliVersionToastSession() {
    shown.clear();
  }
</script>

<script lang="ts">
  import { page } from '$app/stores';
  import { notify } from '$lib/components/patterns/notify';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { selectHostAdministrationContext } from '$store/renderer/slices/principal/principal-selectors';
  import { selectCurrentConnectionId } from '$store/renderer/slices/connections/connections-selectors';
  import { selectDaemonHealth } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { selectProviderCliRequirements } from '$store/renderer/slices/host-requirements/host-requirements-selectors';
  import { checkProviderCliRequirementsRequested } from '$store/renderer/slices/host-requirements/host-requirements-slice';

  const owner$ = selectHostAdministrationContext();
  const host$ = selectCurrentConnectionId();
  const health$ = selectDaemonHealth();
  const result$ = selectProviderCliRequirements();
  const context = $derived(
    $health$ === 'healthy' && !$page.url.pathname.startsWith('/workspace/new') ? $owner$ : null,
  );

  $effect(() => {
    if (context) appStore.dispatch(checkProviderCliRequirementsRequested());
  });

  $effect(() => {
    if (!context || $result$?.context !== context) return;
    for (const warning of $result$.warnings) {
      const key = JSON.stringify([
        $host$,
        warning.providerId,
        warning.version,
        warning.minimumVersion,
      ]);
      if (shown.has(key)) continue;
      shown.add(key);
      notify.warning(
        m.providers_cliVersionWarning_message({
          provider: warning.providerName,
          version: warning.version,
          minimumVersion: warning.minimumVersion,
        }),
      );
    }
  });
</script>
