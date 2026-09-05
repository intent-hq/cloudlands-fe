import { parseUiComponentMetadata } from '../component-metadata';
import { askUserQuestionsFixtures } from './ask-user-questions.fixtures';

export const askUserQuestionsMetadata = parseUiComponentMetadata({
  id: 'ask-user-questions',
  source: 'src/lib/components/ui/ask-user-questions/ask-user-questions.svelte',
  publicImport: '$lib/components/ui/ask-user-questions',
  legacyImports: [],
  exports: [
    'AskUserQuestions',
    'AskUserAnswer',
    'AskUserOption',
    'AskUserQuestion',
    'AskUserQuestionsProps',
  ],
  category: 'primitive',
  owner: 'design-system',
  callers: [],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/ask-user-questions/ask-user-questions.test.ts',
  removalGate:
    'Retain while stepped question flows need keyboard, validation, and controlled-state behavior.',
  dynamicImports: [],
  fixtures: askUserQuestionsFixtures,
  useWhen: ['Collect one or more structured or free-text answers in a stepped flow.'],
  dontUseWhen: ['A native form can present all fields at once without progressive disclosure.'],
});
