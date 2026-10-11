<script lang="ts">
  import type { Question } from '$shared/types/question-resource';
  import type { QuestionWizardDraft } from '$store/renderer/slices/question-ui/question-ui-types';
  import QuestionWizard, { type QuestionAnswer } from '../QuestionWizard.svelte';

  let {
    questions,
    onComplete,
    onDraftChange,
  }: {
    questions: Question[];
    onComplete: (answers: QuestionAnswer[]) => void;
    onDraftChange?: (draft: QuestionWizardDraft) => void;
  } = $props();

  let draft = $state<QuestionWizardDraft>({
    idx: 0,
    answers: questions.map(() => ({ sel: [], text: '', skipped: false })),
  });
</script>

<QuestionWizard
  {questions}
  {draft}
  {onComplete}
  onDraftChange={(next) => {
    draft = next;
    onDraftChange?.(next);
  }}
/>
