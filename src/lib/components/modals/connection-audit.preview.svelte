<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview<{ state: string }>({
    id: 'connection-audit',
    title: 'Connection safety dialogs',
    defaultState: 'certificate',
    states: Object.fromEntries(
      ['certificate', 'certificate-long', 'protocol', 'protocol-long', 'edit-regenerate'].map(
        (state) => [state, { props: { state } }],
      ),
    ),
  });
</script>

<script lang="ts">
  import CertMismatchModal from '$lib/components/layout/CertMismatchModal.svelte';
  import ProtocolMismatchModal from '$lib/components/layout/ProtocolMismatchModal.svelte';
  import EditRegenerateConfirmDialog from '$lib/components/chat/EditRegenerateConfirmDialog.svelte';
  let { state = 'certificate' }: { state?: string } = $props();
  const host = $derived(
    state.endsWith('long')
      ? 'development-server-with-a-long-team-and-environment-name.example.internal'
      : 'team.example.com',
  );
</script>

{#if state.startsWith('certificate')}
  <CertMismatchModal
    static
    event={{
      id: 'team',
      host,
      port: 443,
      expectedFingerprint: 'A1:'.repeat(31) + 'A1',
      actualFingerprint: 'B2:'.repeat(31) + 'B2',
    }}
  />
{:else if state.startsWith('protocol')}
  <ProtocolMismatchModal
    static
    event={{
      id: 'team',
      host,
      port: 443,
      localProtocolVersion: 'preview-local',
      remoteProtocolVersion: 'preview-remote',
    }}
  />
{:else}
  <EditRegenerateConfirmDialog open />
{/if}
