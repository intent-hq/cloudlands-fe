import { parseUiComponentMetadata } from '../component-metadata';
import { spinnerFixtures } from './spinner.fixtures';

export const spinnerMetadata = parseUiComponentMetadata({
  id: 'spinner',
  source: 'src/lib/components/ui/indicators/Spinner.svelte',
  publicImport: '$lib/components/ui/indicators',
  legacyImports: [
    '$lib/components/ui/indicators/AgentBadge.svelte',
    '$lib/components/ui/indicators/UnsavedIndicator.svelte',
  ],
  exports: [
    'AgentBadge',
    'IntentMarkLoader',
    'IntentMarkVariant',
    'Spinner',
    'UnsavedIndicator',
    'intentMarkMotionTiming',
    'intentMarkVariants',
    'spinnerMetadata',
  ],
  category: 'pattern',
  owner: '007-B1',
  callers: [
    'src/features/layout/components/panel-tabs/Tab.svelte',
    'src/lib/component-catalog/renderers/ContentFieldCatalogPreview.svelte',
    'src/lib/components/agent-overview/AgentHierarchyCard.svelte',
    'src/lib/components/chat/ChatMessageNavigator.svelte',
    'src/lib/components/chat/LiveStreamPhaseIndicator.svelte',
    'src/lib/components/chat/StreamingTypingIndicator.svelte',
    'src/lib/components/chat/TypingIndicator.svelte',
    'src/lib/components/chat/streaming-status-utils.ts',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/indicators/Spinner.test.ts',
  removalGate:
    'Retain Spinner while canonical callers and deterministic loading tests pass; AgentBadge and UnsavedIndicator remain internal product exports and are not catalog entries.',
  dynamicImports: [],
  fixtures: spinnerFixtures,
});
