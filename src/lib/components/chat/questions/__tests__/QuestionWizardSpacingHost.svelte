<script lang="ts">
  import type { Question } from '$shared/types/question-resource';
  import QuestionWizard, { type QuestionAnswer } from '../QuestionWizard.svelte';

  let { multiSelect = false }: { multiSelect?: boolean } = $props();
  let collapsed = $state(false);
  let result = $state<QuestionAnswer[] | null>(null);
  const questions = $derived<Question[]>([
    {
      attachmentId: 'spacing-described',
      header: 'Approach',
      question: 'Which approach should we use?',
      options: [
        { label: 'Small change', description: 'Preserve the current behavior.' },
        { label: 'Compare alternatives', description: 'Review the options before continuing.' },
      ],
    },
    {
      attachmentId: 'spacing-labels',
      header: 'Scope',
      question: 'Which surfaces should we include?',
      multiSelect,
      options: [{ label: 'Desktop' }, { label: 'Web' }, { label: 'CLI' }, { label: 'Mobile' }],
    },
    {
      attachmentId: 'spacing-mixed',
      header: 'Review',
      question: 'How should we verify the change?',
      multiSelect: true,
      options: [
        { label: 'Focused tests' },
        {
          label: 'Review the narrow panel and keep its intentionally long label readable',
        },
        {
          label: 'Browser review',
          description: 'Check the rendered layout and keyboard behavior before continuing.',
        },
      ],
    },
  ]);
</script>

<section data-testid="question-spacing-host">
  {#if result}
    <output data-testid="question-spacing-result"
      >{JSON.stringify(result.map(({ selectedLabels }) => selectedLabels))}</output
    >
  {:else}
    <QuestionWizard
      {questions}
      {collapsed}
      onToggleCollapsed={(value) => (collapsed = value)}
      onComplete={(answers) => (result = answers)}
    />
  {/if}
</section>
