<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview<{ state: string }>({
    id: 'agent-decisions-audit',
    title: 'Agent decision modal audit',
    defaultState: 'switch-provider',
    states: Object.fromEntries(
      [
        'switch-provider',
        'switch-model',
        'switch-long',
        'dismiss-proposal',
        'dismiss-questions',
        'handoff',
        'handoff-expanded',
        'handoff-blank',
        'harness-empty',
        'harness-mixed',
      ].map((state) => [state, { props: { state } }]),
    ),
  });
</script>

<script lang="ts">
  import ModelSwitchConfirmDialog from '../chat/ModelSwitchConfirmDialog.svelte';
  import DismissProposalConfirmDialog from '../chat/proposals/DismissProposalConfirmDialog.svelte';
  import DismissQuestionsConfirmDialog from '../chat/questions/DismissQuestionsConfirmDialog.svelte';
  import HarnessFeaturesModal from '../chat/HarnessFeaturesModal.svelte';
  import ReplaceAgentModal from './ReplaceAgentModal.svelte';
  let { state = 'switch-provider' }: { state?: string } = $props();
</script>

{#if state.startsWith('switch-')}
  <ModelSwitchConfirmDialog
    open
    isProviderChange={state !== 'switch-model'}
    fromModelLabel={state === 'switch-long'
      ? 'A very long model label for a custom provider deployment'
      : 'Claude Sonnet'}
    toModelLabel={state === 'switch-model'
      ? 'Claude Opus'
      : state === 'switch-long'
        ? 'custom-provider-with-an-unbroken-model-deployment-name-for-overflow'
        : 'GPT'}
    fromProviderName="Anthropic"
    toProviderName={state === 'switch-model' ? 'Anthropic' : 'OpenAI'}
    fromProviderId="claude-code"
    toProviderId={state === 'switch-model' ? 'claude-code' : 'codex'}
  />
{:else if state === 'dismiss-proposal'}
  <DismissProposalConfirmDialog open />
{:else if state === 'dismiss-questions'}
  <DismissQuestionsConfirmDialog open />
{:else if state.startsWith('handoff')}
  <ReplaceAgentModal open agentName="Design system implementor" specialist="implementor" />
{:else}
  <HarnessFeaturesModal
    open
    version="preview"
    features={state === 'harness-empty'
      ? null
      : { browserAutomation: true, backgroundHooks: true, structuredQuestions: true }}
  />
{/if}
