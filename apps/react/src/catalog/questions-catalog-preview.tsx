// Source: AskUserQuestionsCatalogPreview.svelte. Keep fixture data and initial states identical.
// i18n-ignore (reference catalog fixture content)
import { useState } from 'react';
import {
  AskUserQuestions,
  type AskUserAnswer,
  type AskUserQuestion,
} from '@/components/ui/ask-user-questions';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

const baseOptions = [
  { id: 'speed', title: 'Speed', description: 'Optimize for quick iteration.' },
  { id: 'quality', title: 'Quality', description: 'Prefer a polished result.' },
  { id: 'balance', title: 'Balance', description: 'Keep both priorities in view.' },
];
function questionsFor(fixture: string): AskUserQuestion[] {
  if (['multiple-questions', 'skippable', 'controlled'].includes(fixture))
    return [
      { id: 'priority', title: 'What should we prioritize?', options: baseOptions },
      {
        id: 'audience',
        title: 'Who is this for?',
        options: [
          { id: 'team', title: 'My team' },
          { id: 'customers', title: 'Customers' },
        ],
        skippable: fixture !== 'skippable',
      },
    ];
  if (fixture === 'multi-select')
    return [
      { id: 'features', title: 'Which features matter?', options: baseOptions, multiSelect: true },
    ];
  if (fixture === 'with-other')
    return [
      {
        id: 'direction',
        title: 'Choose a direction',
        options: baseOptions.slice(0, 2),
        allowOther: true,
      },
    ];
  if (fixture === 'free-text')
    return [
      {
        id: 'context',
        title: 'What context should we know?',
        freeText: true,
        freeTextPlaceholder: 'Share a few details…',
      },
    ];
  if (fixture === 'free-text-validation')
    return [
      {
        id: 'name',
        title: 'Name this project',
        freeText: true,
        freeTextMultiline: false,
        freeTextValidate: (value) => (value.length < 3 ? 'Use at least three characters.' : null),
      },
    ];
  if (fixture === 'chip-on-left')
    return [
      { id: 'order', title: 'Choose the first step', options: baseOptions, chipPosition: 'left' },
    ];
  if (fixture === 'stacked-layout')
    return [
      { id: 'approach', title: 'Choose an approach', options: baseOptions, layout: 'stacked' },
    ];
  return [{ id: 'priority', title: 'What should we prioritize?', options: baseOptions }];
}
export function QuestionsCatalogPreview({ fixture }: { fixture: UiComponentFixture }) {
  const [controlledIndex, setControlledIndex] = useState(0);
  const [controlledAnswers, setControlledAnswers] = useState<Record<string, AskUserAnswer>>({});
  const [questions] = useState(() => questionsFor(fixture.id));
  return (
    <div
      className="flex w-full justify-center"
      data-catalog-renderer-fixture={fixture.id}
      data-catalog-rendered-state={fixture.states.join(' ')}
    >
      {fixture.id === 'controlled' ? (
        <AskUserQuestions
          questions={questions}
          currentIndex={controlledIndex}
          answers={controlledAnswers}
          onCurrentIndexChange={setControlledIndex}
          onAnswersChange={setControlledAnswers}
        />
      ) : (
        <AskUserQuestions questions={questions} />
      )}
    </div>
  );
}
