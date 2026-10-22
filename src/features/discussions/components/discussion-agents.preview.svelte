<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  interface Props {
    oldDaemon?: boolean;
    failSend?: boolean;
  }
  export const preview = definePreview<Props>({
    id: 'discussion-agents',
    title: 'Discussion agents',
    defaultState: 'ready',
    states: {
      ready: { props: {} },
      retry: { props: { failSend: true } },
      'old-daemon': { props: { oldDaemon: true } },
    },
  });
</script>

<script lang="ts">
  import DiscussionHost from './__tests__/DiscussionHost.svelte';
  let { oldDaemon = false, failSend = false }: Props = $props();
</script>

<DiscussionHost agentMessaging={!oldDaemon} {failSend} />
