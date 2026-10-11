// Source: src/routes/sandbox/question-wizard/+page.svelte.
// i18n-ignore (source-preserving internal sandbox content)
import { useState } from 'react';
import { QuestionWizard } from '@/features/chat/components/question-wizard';
import type { Question } from '$shared/types/question-resource';
import './question-wizard-page.css';

export const sandboxQuestions: Question[] = [
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

export function QuestionWizardPage() {
  const [result, setResult] = useState('Choose an option to exercise the complete flow.');
  return (
    <article className="question-wizard-showcase" data-parity-status="pending">
      <header>
        <h1>Question wizard</h1>
        <p>A deterministic multi-step showcase using the production question surface.</p>
      </header>
      <section className="wizard-stage">
        <h2>Playground</h2>
        <QuestionWizard
          questions={sandboxQuestions}
          onComplete={() => setResult('Answers submitted.')}
        />
      </section>
      <output>{result}</output>
    </article>
  );
}
