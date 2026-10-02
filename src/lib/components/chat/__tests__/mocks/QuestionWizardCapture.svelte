<script lang="ts">
  import type { QuestionWizardDraft } from '$store/renderer/slices/question-ui/question-ui-types';

  let { draft }: { draft?: QuestionWizardDraft } = $props();
</script>

<output data-testid="question-wizard-capture" data-draft-answer-count={draft?.answers.length ?? 0}
></output>
