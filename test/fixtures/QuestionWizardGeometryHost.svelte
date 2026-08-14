<script lang="ts">
  import QuestionWizard from '$lib/components/chat/questions/QuestionWizard.svelte';
  import type { Question } from '$shared/types/question-resource';

  let {
    collapsed = false,
    optionCount = 3,
    questionCount = 3,
    safeArea = 0,
    longChat = false,
  }: {
    collapsed?: boolean;
    optionCount?: number;
    questionCount?: number;
    safeArea?: number;
    longChat?: boolean;
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
      header: `Question ${index + 1}`,
      question: 'Where should this bounded question surface sit?',
      options,
      multiSelect: optionCount > 1,
    })),
  );
</script>

<main
  class="flex h-full min-h-0 w-full min-w-0 flex-col bg-background text-foreground"
  data-testid="panel-boundary"
>
  <div class="min-h-0 flex-1 overflow-y-auto" data-testid="chat-scroll-region">
    <div style:height={longChat ? '960px' : '24px'} data-testid="transcript-content"></div>
  </div>
  <div
    class="conversation-composer relative z-20 w-full"
    data-testid="conversation-composer-boundary"
  >
    <div class="w-full" data-testid="question-wizard-slot">
      <QuestionWizard {questions} {collapsed} />
    </div>
  </div>
  <div style:height={`${safeArea}px`} class="shrink-0" data-testid="platform-safe-area"></div>
</main>
