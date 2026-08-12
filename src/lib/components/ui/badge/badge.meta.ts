import { parseUiComponentMetadata } from '../component-metadata';
import { badgeFixtures } from './badge.fixtures';

export const badgeMetadata = parseUiComponentMetadata({
  id: 'badge',
  source: 'src/lib/components/ui/badge/badge.svelte',
  publicImport: '$lib/components/ui/badge',
  legacyImports: [],
  exports: ['Badge', 'BadgeProps', 'BadgeVariant', 'badgeMetadata', 'badgeVariants'],
  category: 'primitive',
  owner: '007-B1',
  callers: [
    'src/lib/components/chat/ChatHeader.svelte',
    'src/lib/components/code-review/CodeReviewPanel.svelte',
    'src/lib/components/code-review/CodeReviewTabContent.svelte',
    'src/lib/components/file-tracking/accept-changes/PRNode.svelte',
    'src/lib/components/workspace/PullRequestCreator.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/badge/badge.test.ts',
  removalGate: 'Retain while exported and semantic variants and fixtures pass.',
  dynamicImports: [],
  fixtures: badgeFixtures,
});
