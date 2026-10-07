<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import ReleaseNotesModal from '$lib/components/modals/ReleaseNotesModal.svelte';
  import { store } from '$store/renderer/store';
  import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import DaemonAuditHarness from '../DaemonAuditHarness.svelte';

  let {
    scenario = 'external',
    notesOpen = $bindable(false),
    notesStatus = 'ready',
    connected = false,
  }: {
    scenario?: string;
    notesOpen?: boolean;
    notesStatus?: 'ready' | 'loading' | 'unavailable';
    connected?: boolean;
  } = $props();
  let dismissals = $state(0);
  let backgroundActions = $state(0);
  const releaseNotes = {
    version: '0.0.0-dialog',
    notes: `## Changes\n\n${Array.from({ length: 24 }, (_, index) => `- Change ${index + 1}: keep your workspace available while the device reconnects.`).join('\n')}`,
    url: 'https://example.invalid/dialog-release',
  };

  $effect(() => {
    if (connected) store.dispatch(connectionStatusChanged('connected'));
  });
</script>

<div class="p-6">
  <Button onclick={() => backgroundActions++}>Background action</Button>
</div>
<output
  data-testid="dialog-stacking-actions"
  data-dismissals={dismissals}
  data-background={backgroundActions}
></output>
<DaemonAuditHarness state={scenario} />
<ReleaseNotesModal
  bind:open={notesOpen}
  releaseNotes={notesStatus === 'ready' ? releaseNotes : null}
  loading={notesStatus === 'loading'}
  onClose={() => dismissals++}
/>
