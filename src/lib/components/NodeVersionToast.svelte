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
   * Renders nothing; mounted once in the (app) shell. Requests a fresh
   * host-requirements probe once the daemon is healthy (takeLeading in the
   * saga dedupes an already-running probe) and raises a single warning toast
   * per session when the node requirement is unmet outside onboarding. Only a
   * probe observed to start and settle after that request — with the daemon
   * still healthy — is trusted, so stale ok:false state (e.g. a probe that
   * failed while the daemon was unreachable during onboarding) can never
   * raise a false warning. Onboarding (/workspace/new) is excluded —
   * OnboardingRequirementsStep owns the blocked posture there.
   */
  import { page } from '$app/stores';
  import { toast } from 'svelte-sonner';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { checkHostRequirementsRequested } from '$store/renderer/slices/host-requirements/host-requirements-slice';
  import {
    selectHostRequirementsChecking,
    selectNodeRequirement,
  } from '$store/renderer/slices/host-requirements/host-requirements-selectors';
  import { selectDaemonHealth } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { MINIMUM_NODE_VERSION } from '$shared/constants/auggie';

  const node$ = selectNodeRequirement();
  const checking$ = selectHostRequirementsChecking();
  const health$ = selectDaemonHealth();

  // Onboarding renders at /workspace/new (WorkspaceSurface); suppress there.
  // Pathname form matches the (app) layout's own onboarding exclusion.
  const isWorkspaceCreation = $derived($page.url.pathname.startsWith('/workspace/new'));

  // Fresh-probe handshake: request once healthy, then wait for the probe to
  // be observed running (checking true) and settling (checking false). If the
  // daemon drops mid-handshake the flags reset, so recovery re-requests a
  // fresh probe instead of trusting a result that settled during the outage.
  let probeRequested = $state(false);
  let probeStarted = $state(false);

  $effect(() => {
    if ($health$ === 'healthy') {
      if (!probeRequested) {
        probeRequested = true;
        appStore.dispatch(checkHostRequirementsRequested());
      }
    } else {
      probeRequested = false;
      probeStarted = false;
    }
  });

  $effect(() => {
    if (!probeRequested) return;
    if ($checking$) {
      probeStarted = true;
      return;
    }
    if (!probeStarted) return;
    const node = $node$;
    if (
      hasShownThisSession ||
      isWorkspaceCreation ||
      $health$ !== 'healthy' ||
      !node.checked ||
      node.ok
    )
      return;
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
