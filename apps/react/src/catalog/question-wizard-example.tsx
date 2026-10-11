// i18n-ignore (internal controlled-prop and native clipboard exercise)
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  QuestionWizard,
  type QuestionAnswer,
  type QuestionWizardHandle,
} from '@/features/chat/components/question-wizard';
import type { QuestionWizardDraft } from '../../../../src/store/renderer/slices/question-ui/question-ui-types';
import { sandboxQuestions } from './question-wizard-page';

export function QuestionWizardExample() {
  const wizard = useRef<QuestionWizardHandle>(null);
  const [draft, setDraft] = useState<QuestionWizardDraft>(() => ({
    idx: 0,
    answers: sandboxQuestions.map(() => ({ sel: [], text: '', skipped: false })),
  }));
  const [collapsed, setCollapsed] = useState(false);
  const [admit, setAdmit] = useState(true);
  const [answers, setAnswers] = useState<QuestionAnswer[]>([]);
  const [attempts, setAttempts] = useState(0);
  const [resolved, setResolved] = useState(0);
  const [dismissed, setDismissed] = useState(0);
  const [focused, setFocused] = useState<boolean | null>(null);
  return (
    <section
      className="grid gap-4"
      data-functional-example="question-wizard"
      aria-label="Controlled question wizard"
    >
      <h2>Question wizard and native image paste</h2>
      <p>
        Paste image files into an answer. FileReader reads their bytes locally; no file is uploaded.
        The draft output contains choices and text only.
      </p>
      <Switch aria-label="Accept wizard completion" checked={admit} onCheckedChange={setAdmit} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setFocused(wizard.current?.focusQuestion() ?? false)}>
          Focus question
        </Button>
        <Button variant="outline" onClick={() => setCollapsed((value) => !value)}>
          Toggle wizard collapse
        </Button>
      </div>
      <QuestionWizard
        ref={wizard}
        questions={sandboxQuestions}
        draft={draft}
        onDraftChange={setDraft}
        collapsed={collapsed}
        onToggleCollapsed={setCollapsed}
        onComplete={(value) => {
          setAttempts((count) => count + 1);
          if (!admit) return false;
          setAnswers(value);
          return true;
        }}
        onDismiss={() => setDismissed((count) => count + 1)}
        onResolved={() => setResolved((count) => count + 1)}
      />
      <output aria-label="Wizard draft">{JSON.stringify(draft)}</output>
      <output aria-label="Wizard submitted answers" className="break-all">
        {JSON.stringify(answers)}
      </output>
      <output aria-label="Wizard completion attempts">{attempts}</output>
      <output aria-label="Wizard resolved count">{resolved}</output>
      <output aria-label="Wizard dismissed count">{dismissed}</output>
      <output aria-label="Wizard focus result">{String(focused)}</output>
    </section>
  );
}
