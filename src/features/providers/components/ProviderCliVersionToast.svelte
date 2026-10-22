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
  import {
    checkProviderCliRequirementsRequested,
    providerCliUpdateRequested,
  } from '$store/renderer/slices/host-requirements/host-requirements-slice';
  import type { ProviderCliWarning } from '$features/providers/utils/provider-cli-warnings';

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

  async function runUpdate(warning: ProviderCliWarning) {
    try {
      await appStore.dispatch(providerCliUpdateRequested(warning.providerId));
    } catch (cause) {
      notify.error(cause instanceof Error ? cause.message : m.terminal_adapter_openFailed_error());
    }
  }

  $effect(() => {
    if (!context || $result$?.context !== context) return;
    for (const warning of $result$.warnings) {
      const key = JSON.stringify([
        $host$,
        warning.providerId,
        warning.version,
        warning.minimumVersion,
        warning.bundledVersion ?? null,
      ]);
      if (shown.has(key)) continue;
      shown.add(key);
      const bundledVersion = warning.bundledVersion;
      const title = bundledVersion
        ? m.providers_cliVersionWarning_bundled_title({ provider: warning.providerName })
        : m.providers_cliVersionWarning_title({ provider: warning.providerName });
      const description = bundledVersion
        ? m.providers_cliVersionWarning_bundled_description({
            version: warning.version,
            minimumVersion: warning.minimumVersion,
            bundledVersion,
          })
        : m.providers_cliVersionWarning_description({
            version: warning.version,
            minimumVersion: warning.minimumVersion,
          });
      notify.warning(title, {
        description,
        ...(warning.updateCommand
          ? {
              action: {
                label: m.providers_cliVersionWarning_update_action(),
                onClick: () => void runUpdate(warning),
              },
            }
          : {}),
      });
    }
  });
</script>
