<!--
  Test harness mirroring ChatPanel's wizard block: the wizard mounts under
  `{#if pendingQuestions}` with a `draftKey` prop derived from the nullable
  reactive source, so nulling the source tears the wizard down while the
  prop expression can no longer be evaluated (regression host for the
  teardown-time `Cannot read properties of null` crash).
-->
<script lang="ts">
  import QuestionWizard from '../QuestionWizard.svelte';
  import { wizardDraftKey } from '../wizard-draft-storage';
  import type { Question } from '$shared/types/question-resource';

  interface Props {
    questions: Question[];
    pendingQuestions: { messageId: string } | null;
  }

  let { questions, pendingQuestions }: Props = $props();
</script>

{#if pendingQuestions}
  {#key pendingQuestions.messageId}
    <QuestionWizard
      {questions}
      draftKey={wizardDraftKey('agent-draft-test', pendingQuestions.messageId)}
    />
  {/key}
{/if}
