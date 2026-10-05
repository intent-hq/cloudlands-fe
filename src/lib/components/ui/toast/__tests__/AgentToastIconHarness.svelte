<script lang="ts">
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';
  import Toast from '../Toast.svelte';
  import AgentFailureToast from '../AgentFailureToast.svelte';
  import AgentAttentionToast from '../AgentAttentionToast.svelte';

  let { kind }: { kind: 'failure' | 'attention' } = $props();
  const toasterId = 'agent-icon-audit';
  const id = 'agent-icon-fixture';
  onMount(() => {
    const common = {
      title: 'Design reviewer with a long name needs your attention',
      keySlot: 1,
      onSwitchTo: () => {},
      onClose: () => toast.dismiss(id),
    };
    const details =
      'A detailed explanation that wraps across multiple lines without moving the leading icon.';
    const options = { id, toasterId, duration: Number.POSITIVE_INFINITY };
    if (kind === 'failure') {
      toast.custom(AgentFailureToast, {
        ...options,
        componentProps: {
          ...common,
          errorSummary: details,
          retryLabel: 'Retry',
          retrying: false,
          onRetry: () => {},
        },
      });
    } else {
      toast.custom(AgentAttentionToast, {
        ...options,
        componentProps: {
          ...common,
          reason: details,
          kind: 'blocker',
        },
      });
    }
    return () => toast.dismiss(id);
  });
</script>

<Toast {toasterId} />
