<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { setupEncoderEffortPreview } from './encoder-effort.preview-fixture';

  export const preview = definePreview({
    id: 'encoder-effort',
    title: 'Micro encoder effort feedback',
    defaultState: 'high',
    states: { high: { props: {}, setup: setupEncoderEffortPreview } },
    captureReadiness: {
      selector: '[data-testid="effort-picker-trigger"], [role="status"]',
      count: 2,
    },
  });
</script>

<script lang="ts">
  import EffortPicker from '$lib/components/chat/input/EffortPicker.svelte';
  import EncoderCycleHud from './EncoderCycleHud.svelte';
</script>

<!-- i18n-ignore (isolated, static preview of simulated encoder feedback) -->
<section
  class="relative transform h-48 w-full rounded-lg border border-border bg-background p-6 text-foreground"
  data-testid="encoder-effort-preview"
>
  <p class="type-body mb-4">Simulated encoder feedback</p>
  <EffortPicker agentId="encoder-preview-agent" workspaceId="encoder-preview-workspace" disabled />
  <EncoderCycleHud />
</section>
