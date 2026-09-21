import { parseUiComponentMetadata } from '../component-metadata';
import { badgeFixtures } from './badge.fixtures';

export const badgeMetadata = parseUiComponentMetadata({
  id: 'badge',
  source: 'src/lib/components/ui/badge/badge.svelte',
  publicImport: '$lib/components/ui/badge',
  legacyImports: [],
  exports: ['Badge'],
  category: 'primitive',
  owner: '007-B1',
  callers: [
    'src/lib/components/code-review/CodeReviewPanel.svelte',
    'src/lib/components/code-review/CodeReviewTabContent.svelte',
    'src/lib/components/workspace/PullRequestCreator.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/badge/badge.test.ts',
  removalGate:
    'Retain solid/dot status and categorical colours; legacy variants remain compatibility aliases.',
  dynamicImports: [],
  useWhen: [
    'Show a compact status: neutral (gray), information (blue), success (green), warning (amber), or danger (red). Name the state in text.',
    'Use solid or dot with the same status colour mapping; the presentation does not change the meaning.',
    'Categorical colours are for categorisation only, after the five status meanings.',
  ],
  dontUseWhen: [
    'Use plain text for ordinary metadata that does not need a status or category marker.',
    'Use Button for a primary action, InputMessage for field validation, or an alert for an explanation that needs attention.',
    'Do not rely on colour alone or use decorative colours to invent additional status meanings.',
  ],
  usage: '<Badge variant="solid" color="green">Complete</Badge>',
  fixtures: badgeFixtures,
});
