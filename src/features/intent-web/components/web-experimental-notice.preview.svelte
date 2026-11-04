<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'web-experimental-notice',
    title: 'Intent Web: experimental notice',
    defaultState: 'intent-web',
    states: {
      'intent-web': { props: { static: true, hostManagesConnections: true } },
      'browser-access': { props: { static: true, hostManagesConnections: false } },
    },
  });
</script>

<script lang="ts">
  import WebExperimentalNotice from './WebExperimentalNotice.svelte';

  let {
    static: staticPosition = false,
    hostManagesConnections = false,
  }: { static?: boolean; hostManagesConnections?: boolean } = $props();
</script>

<!-- Tall frame: the dialog caps itself at 80vh, and captures fit the viewport to this frame. -->
<div class="min-h-[42rem]">
  <WebExperimentalNotice static={staticPosition} {hostManagesConnections} onDismiss={() => {}} />
</div>
