<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview({
    id: 'discussion-mention',
    title: 'Discussion mention notification',
    defaultState: 'off-screen',
    captureReadiness: { selector: '[data-discussion-mention-preview] [data-sonner-toast]' },
    states: { 'off-screen': { props: {} } },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { notify } from '$lib/components/patterns/notify';
  import { Toast } from '$lib/components/ui/toast';
  import { m } from '$shared/paraglide/messages.js';

  onMount(() => {
    // i18n-ignore (sample person and message supplied as fixture content)
    const id = notify.info(m.notifications_discussion_mention_title({ name: 'Amelia' }), {
      toasterId: 'discussion-mention-preview',
      duration: Number.POSITIVE_INFINITY,
      // i18n-ignore (sample discussion message)
      description: '@Sam could you review the discussion layout?',
      action: { label: m.notifications_discussion_open_label(), onClick: () => undefined },
    });
    return () => notify.dismiss(id);
  });
</script>

<div class="p-4" data-discussion-mention-preview>
  <Toast
    regionId="discussion-mention-region"
    toasterId="discussion-mention-preview"
    staticPosition
  />
</div>
