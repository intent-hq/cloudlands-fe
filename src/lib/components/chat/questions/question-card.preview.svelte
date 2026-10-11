<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { Question } from '$shared/types/question-resource';
  import type { QuestionWizardDraft } from '$store/renderer/slices/question-ui/question-ui-types';
  import QuestionWizard, { type QuestionAnswer } from './QuestionWizard.svelte';

  interface Props {
    multiSelect?: boolean;
    longContent?: boolean;
    sequence?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'question-card',
    title: 'Question wizard',
    defaultState: 'single',
    states: {
      single: { props: {} },
      multiple: { props: { multiSelect: true } },
      'long-content': { props: { longContent: true } },
      sequence: { props: { sequence: true } },
    },
  });
</script>

<script lang="ts">
  let { multiSelect = false, longContent = false, sequence = false }: Props = $props();
  let draft = $state<QuestionWizardDraft>();
  let collapsed = $state(false);
  let result = $state<QuestionAnswer[] | null>(null);
  let dismissed = $state(false);
  const questions = $derived<Question[]>([
    {
      attachmentId: 'preview-review-plan',
      header: longContent
        ? 'Review the plan for the next small interface improvement'
        : 'Review plan',
      question: 'How should we approach the next improvement?',
      explanation: 'Choose an approach, or write a different answer below.',
      multiSelect,
      options: [
        {
          label: 'Start with the smallest change',
          description: longContent
            ? 'Keep the existing behavior and verify a deliberately long description wraps within a narrow panel, including an uninterrupted reference: component-layout-regression-verification.'
            : 'Preserve the current behavior and verify the result.',
        },
        {
          label: 'Compare two approaches',
          description: 'Review safe fixture examples before choosing.',
        },
        {
          label: 'Discuss the tradeoffs',
          description: 'Agree on the scope before making changes.',
        },
      ],
    },
    ...(sequence
      ? [
          {
            attachmentId: 'preview-review-scope',
            header: 'Scope',
            question: 'Which surface should we start with?',
            options: [{ label: 'Desktop' }, { label: 'Mobile' }],
          },
          {
            attachmentId: 'preview-review-verification',
            header: 'Verification',
            question: 'How should we verify the change?',
            options: [{ label: 'Focused tests' }, { label: 'Browser review' }],
          },
        ]
      : []),
  ]);
</script>

<section class="w-full min-w-0" data-testid="question-preview">
  {#if dismissed}
    <p role="status">Question dismissed.</p>
  {:else if result}
    <output data-testid="question-result"
      >{JSON.stringify(
        result.map(({ selectedLabels, freeText, skipped }) => ({
          selectedLabels,
          freeText,
          skipped,
        })),
      )}</output
    >
  {:else}
    <QuestionWizard
      {questions}
      {draft}
      onDraftChange={(next) => (draft = next)}
      {collapsed}
      onToggleCollapsed={(value) => (collapsed = value)}
      onComplete={(answers) => (result = answers)}
      onDismiss={() => {
        dismissed = true;
      }}
    />
  {/if}
</section>
