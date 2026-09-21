<script lang="ts">
  import QuestionWizard from '$lib/components/chat/questions/QuestionWizard.svelte';
  import type { Question } from '$shared/types/question-resource';

  const questions: Question[] = [
    {
      attachmentId: 'sandbox-interface',
      header: 'Interface direction',
      question: 'Which visual direction should this workspace use?',
      options: [
        { label: 'Focused', description: 'Quiet surfaces with deliberate emphasis.' },
        { label: 'Expressive', description: 'More color and stronger hierarchy.' },
        { label: 'Dense', description: 'Compact controls for information-rich workflows.' },
      ],
      multiSelect: false,
    },
    {
      attachmentId: 'sandbox-surfaces',
      header: 'Priority surfaces',
      question: 'Which areas should receive the new system first?',
      options: [{ label: 'Navigation' }, { label: 'Composer' }, { label: 'Settings' }],
      multiSelect: true,
    },
  ];
  let result = $state('Choose an option to exercise the complete flow.');
</script>

<article class="showcase-page">
  <header>
    <h1>Question wizard</h1>
    <p>A deterministic multi-step showcase using the production question surface.</p>
  </header>
  <section class="wizard-stage">
    <h2>Playground</h2>
    <QuestionWizard {questions} onComplete={() => (result = 'Answers submitted.')} />
  </section>
  <output>{result}</output>
</article>

<style>
  .showcase-page {
    display: grid;
    width: 100%;
    min-width: 0;
    gap: 2rem;
    padding: 7rem 1.5rem;
  }
  .wizard-stage {
    width: min(100%, 680px);
    min-width: 0;
    margin-inline: auto;
  }
  h1 {
    font-size: 1.75rem;
    font-weight: 400;
    line-height: 1;
  }
  h2 {
    margin-bottom: 0.75rem;
    font-size: 1rem;
    font-weight: 400;
  }
  header p,
  output {
    margin-top: 0.5rem;
    color: hsl(var(--muted-foreground));
    font-size: var(--text-caption-size);
    line-height: 1.6;
  }
</style>
