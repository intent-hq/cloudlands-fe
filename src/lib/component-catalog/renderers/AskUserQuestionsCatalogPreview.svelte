<script lang="ts">
  import {
    AskUserQuestions,
    type AskUserAnswer,
    type AskUserQuestion,
  } from '$lib/components/ui/ask-user-questions';
  import type { CatalogRendererProps } from '../catalog-renderers';

  let { fixture }: CatalogRendererProps = $props();
  let controlledIndex = $state(0);
  let controlledAnswers = $state<Record<string, AskUserAnswer>>({});

  const baseOptions = [
    { id: 'speed', title: 'Speed', description: 'Optimize for quick iteration.' },
    { id: 'quality', title: 'Quality', description: 'Prefer a polished result.' },
    { id: 'balance', title: 'Balance', description: 'Keep both priorities in view.' },
  ];

  const questions = $derived.by<AskUserQuestion[]>(() => {
    if (
      fixture.id === 'multiple-questions' ||
      fixture.id === 'skippable' ||
      fixture.id === 'controlled'
    ) {
      return [
        { id: 'priority', title: 'What should we prioritize?', options: baseOptions },
        {
          id: 'audience',
          title: 'Who is this for?',
          options: [
            { id: 'team', title: 'My team' },
            { id: 'customers', title: 'Customers' },
          ],
          skippable: fixture.id !== 'skippable',
        },
      ];
    }
    if (fixture.id === 'multi-select')
      return [
        {
          id: 'features',
          title: 'Which features matter?',
          options: baseOptions,
          multiSelect: true,
        },
      ];
    if (fixture.id === 'with-other')
      return [
        {
          id: 'direction',
          title: 'Choose a direction',
          options: baseOptions.slice(0, 2),
          allowOther: true,
        },
      ];
    if (fixture.id === 'free-text')
      return [
        {
          id: 'context',
          title: 'What context should we know?',
          freeText: true,
          freeTextPlaceholder: 'Share a few details…',
        },
      ];
    if (fixture.id === 'free-text-validation')
      return [
        {
          id: 'name',
          title: 'Name this project',
          freeText: true,
          freeTextMultiline: false,
          freeTextValidate: (value) => (value.length < 3 ? 'Use at least three characters.' : null),
        },
      ];
    if (fixture.id === 'chip-on-left')
      return [
        { id: 'order', title: 'Choose the first step', options: baseOptions, chipPosition: 'left' },
      ];
    if (fixture.id === 'stacked-layout')
      return [
        { id: 'approach', title: 'Choose an approach', options: baseOptions, layout: 'stacked' },
      ];
    return [{ id: 'priority', title: 'What should we prioritize?', options: baseOptions }];
  });
</script>

<div
  class="flex w-full justify-center"
  data-catalog-renderer-fixture={fixture.id}
  data-catalog-rendered-state={fixture.states.join(' ')}
>
  {#if fixture.id === 'controlled'}
    <AskUserQuestions
      {questions}
      currentIndex={controlledIndex}
      answers={controlledAnswers}
      onCurrentIndexChange={(next) => (controlledIndex = next)}
      onAnswersChange={(next) => (controlledAnswers = next)}
    />
  {:else}
    <AskUserQuestions {questions} />
  {/if}
</div>
