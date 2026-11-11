<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  type Fixture = 'available' | 'large-repo-rules' | 'unavailable';

  interface HarnessFeaturesModalPreviewProps {
    fixture: Fixture;
  }

  export const preview = definePreview<HarnessFeaturesModalPreviewProps>({
    id: 'harness-features-modal',
    title: 'Harness features with starting context',
    defaultState: 'available',
    states: {
      available: { props: { fixture: 'available' } },
      'large-repo-rules': { props: { fixture: 'large-repo-rules' } },
      unavailable: { props: { fixture: 'unavailable' } },
    },
  });
</script>

<script lang="ts">
  import { parsePromptBreakdown } from '$features/agent/prompt-breakdown/prompt-breakdown';
  import { promptBreakdownFixtures } from '$features/agent/prompt-breakdown/prompt-breakdown.fixtures';
  import HarnessFeaturesModal from './HarnessFeaturesModal.svelte';

  let { fixture }: HarnessFeaturesModalPreviewProps = $props();

  const breakdown = $derived(parsePromptBreakdown(promptBreakdownFixtures[fixture]));
  const features = {
    structuredQuestions: true,
    backgroundHooks: true,
    browserAutomation: true,
    taskGraph: false,
    peerAgents: false,
  };
</script>

<HarnessFeaturesModal open static version="3.12" {features} {breakdown} />
