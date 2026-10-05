<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    stacked?: boolean;
    failure?: boolean;
  }
  export const preview = definePreview<Props>({
    id: 'toast-stack',
    title: 'Mixed-height toast stack',
    defaultState: 'collapsed',
    states: {
      collapsed: { props: { stacked: true } },
      discussion: { props: { stacked: false } },
      failure: { props: { stacked: false, failure: true } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import Toast from './Toast.svelte';
  import AgentAttentionToast from './AgentAttentionToast.svelte';
  import AgentFailureToast from './AgentFailureToast.svelte';
  import { toast } from 'svelte-sonner';

  let { stacked = true, failure = false }: Props = $props();
  let switches = $state(0);
  let retries = $state(0);
  const toasterId = 'mixed-toast-preview';
  const customId = 'mixed-toast-custom';
  const successId = 'mixed-toast-success';
  const close = () => toast.dismiss(customId);
  function showDiscussion() {
    const common = {
      id: customId,
      toasterId,
      duration: Number.POSITIVE_INFINITY,
    };
    if (failure) {
      toast.custom(AgentFailureToast, {
        ...common,
        componentProps: {
          title: 'Preview agent failed',
          errorSummary:
            'The fixture stopped before completing the task. Retry or return to the agent.',
          retryLabel: 'Retry preview',
          retrying: false,
          onRetry: () => {
            retries += 1;
          },
          onSwitchTo: () => {
            switches += 1;
          },
          onClose: close,
        },
      });
    } else {
      toast.custom(AgentAttentionToast, {
        ...common,
        componentProps: {
          title: 'Preview agent requests a discussion',
          reason:
            'Choose whether the fixture should include more diagnostic details before continuing this demo task.',
          kind: 'discussion',
          onSwitchTo: () => {
            switches += 1;
          },
          onClose: close,
        },
      });
    }
  }
  function addSuccess() {
    toast.success('Added 1 image to context', {
      id: successId,
      toasterId,
      duration: Number.POSITIVE_INFINITY,
    });
  }
  onMount(() => {
    showDiscussion();
    if (stacked) addSuccess();
    return () => {
      toast.dismiss(customId);
      toast.dismiss(successId);
    };
  });
</script>

<div class="min-h-96 p-4">
  <div class="flex flex-wrap gap-2">
    <Button onclick={showDiscussion}>Show discussion</Button>
    <Button onclick={addSuccess}>Add success</Button>
  </div>
  <output data-testid="toast-switches" class="sr-only">{switches}</output>
  <output data-testid="toast-retries" class="sr-only">{retries}</output>
  <Toast {toasterId} />
</div>
