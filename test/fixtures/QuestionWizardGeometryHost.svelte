<script lang="ts">
  import QuestionWizard, {
    type QuestionAnswer,
  } from '$lib/components/chat/questions/QuestionWizard.svelte';
  import type { Question } from '$shared/types/question-resource';

  let {
    collapsed = false,
    optionCount = 3,
    questionCount = 3,
    safeArea = 0,
    longChat = false,
    longHeader = false,
    multiSelect,
  }: {
    collapsed?: boolean;
    optionCount?: number;
    questionCount?: number;
    safeArea?: number;
    longChat?: boolean;
    longHeader?: boolean;
    multiSelect?: boolean;
  } = $props();

  const options = $derived(
    Array.from({ length: optionCount }, (_, index) => ({
      label: `Option ${index + 1}`,
      description: index === 0 ? 'A concise option description.' : undefined,
    })),
  );
  const questions: Question[] = $derived(
    Array.from({ length: questionCount }, (_, index) => ({
      attachmentId: `geometry-question-${index + 1}`,
      header: longHeader
        ? `Question ${index + 1} with a deliberately long header that must truncate safely`
        : `Question ${index + 1}`,
      question: 'Where should this bounded question surface sit?',
      options,
      multiSelect: multiSelect ?? optionCount > 1,
    })),
  );
  let completionCount = $state(0);
  let completedLabels = $state('');

  function handleComplete(answers: QuestionAnswer[]) {
    completionCount += 1;
    completedLabels = answers.flatMap((answer) => answer.selectedLabels).join(',');
  }
</script>

<main
  class="flex h-full min-h-0 w-full min-w-0 flex-col bg-background text-foreground"
  data-testid="panel-boundary"
  data-completion-count={completionCount}
  data-completed-labels={completedLabels}
>
  <div class="min-h-0 flex-1 overflow-y-auto" data-testid="chat-scroll-region">
    <div style:height={longChat ? '960px' : '24px'} data-testid="transcript-content"></div>
  </div>
  <div
    class="conversation-composer relative z-20 w-full"
    data-testid="conversation-composer-boundary"
  >
    <div class="w-full" data-testid="question-wizard-slot">
      <QuestionWizard {questions} {collapsed} onComplete={handleComplete} onDismiss={() => {}} />
    </div>
  </div>
  <div style:height={`${safeArea}px`} class="shrink-0" data-testid="platform-safe-area"></div>
</main>
