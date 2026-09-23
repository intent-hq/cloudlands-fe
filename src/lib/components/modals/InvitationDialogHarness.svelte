<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import InviteConsentModal from './InviteConsentModal.svelte';
  import InviteNoticeModal from './InviteNoticeModal.svelte';
  let { kind = 'notice' }: { kind?: 'notice' | 'consent' | 'sign-in' } = $props();
  let open = $state(false);
  let responses = $state<string[]>([]);
</script>

<Button onclick={() => (open = true)}>Open invitation</Button>
<output aria-label="Responses">{responses.join(',')}</output>
{#if kind === 'notice'}
  <InviteNoticeModal
    bind:open
    payload={{ requestId: 'audit', kind: 'failed', reason: 'expired' }}
    onAcknowledge={() => (responses = [...responses, 'acknowledged'])}
  />
{:else}
  <InviteConsentModal
    bind:open
    payload={kind === 'sign-in'
      ? {
          requestId: 'audit',
          mode: 'sign-in-required',
          reason: 'not-connected',
          workspaceTitle: 'Design system',
          hostLabel: 'Team server',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://github.com/login/device',
          expiresInMs: 900000,
        }
      : {
          requestId: 'audit',
          mode: 'prove',
          workspaceTitle: 'Design system',
          hostLabel: 'Team server',
          login: 'designer',
        }}
    onRespond={(action) => (responses = [...responses, action])}
  />
{/if}
