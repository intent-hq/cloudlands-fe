<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'confirm-items',
    title: 'Confirm with affected items',
    defaultState: 'unsloth-switch',
    states: {
      'unsloth-switch': { props: {} },
    },
  });
</script>

<script lang="ts">
  import ConfirmRequestView from './ConfirmRequestView.svelte';
</script>

<!-- i18n-ignore (preview fixture copy) -->
<div class="min-h-96 p-4">
  <ConfirmRequestView
    static
    request={{
      kind: 'confirm',
      options: {
        title: 'Switch the Unsloth model?',
        description:
          'This loads unsloth/gemma-3-27b-it-GGUF on the Unsloth server. These 3 agents lose their current model:',
        items: [
          { label: 'Planner', detail: 'Dark mode toggle' },
          { label: 'Reviewer' },
          {
            label: 'Release notes writer with a very long agent name',
            detail: 'A workspace with a long title that does not fit',
          },
        ],
        destructive: true,
        confirmLabel: 'Switch model',
      },
    }}
    onAccept={() => {}}
    onCancel={() => {}}
  />
</div>
