<script lang="ts" module>
  // Once-per-session latch: survives remounts within a renderer session so
  // the warning never repeats (successor to the old home-page banner).
  let hasShownThisSession = false;

  /** Test-only reset for the once-per-session latch. */
  export function resetNodeVersionToastSessionLatch() {
    hasShownThisSession = false;
  }
</script>

<script lang="ts">
  /**
   * NodeVersionToast — post-onboarding surfacing of a broken/insufficient
   * Node.js install on the daemon host.
   *
   * Renders nothing; mounted once in the (app) shell. Ensures the
   * host-requirements probe group has run (dispatched only once the daemon is
   * healthy, so a transport failure never folds into a false "node missing"
   * answer) and raises a single warning toast per session when the node
   * requirement is unmet outside onboarding. Onboarding (/workspace/new) is
   * excluded — OnboardingRequirementsStep owns the blocked posture there.
   */
  import { page } from '$app/stores';
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { ensureHostRequirementsChecked } from '$store/renderer/slices/host-requirements/host-requirements-slice';
  import { selectNodeRequirement } from '$store/renderer/slices/host-requirements/host-requirements-selectors';
  import { selectDaemonHealth } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { MINIMUM_NODE_VERSION } from '$shared/constants/auggie';

  const node$ = selectNodeRequirement();
  const health$ = selectDaemonHealth();

  // Onboarding renders at /workspace/new (WorkspaceSurface); suppress there.
  const isOnboarding = $derived($page.params.id === 'new');

  let ensureDispatched = false;
  $effect(() => {
    if ($health$ === 'healthy' && !ensureDispatched) {
      ensureDispatched = true;
      appStore.dispatch(ensureHostRequirementsChecked());
    }
  });

  $effect(() => {
    const node = $node$;
    if (hasShownThisSession || isOnboarding || !node.checked || node.ok) return;
    hasShownThisSession = true;
    toast.warning(
      node.version
        ? m.lib_nodeVersionWarning_haveVersion_message({
            minimumVersion: MINIMUM_NODE_VERSION,
            nodeVersion: node.version,
          })
        : m.lib_nodeVersionWarning_notFound_message({ minimumVersion: MINIMUM_NODE_VERSION }),
    );
  });
</script>
