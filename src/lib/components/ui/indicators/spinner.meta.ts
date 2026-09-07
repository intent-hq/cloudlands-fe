import { parseUiComponentMetadata } from '../component-metadata';
import { spinnerFixtures } from './spinner.fixtures';

export const spinnerMetadata = parseUiComponentMetadata({
  id: 'loading-indicator',
  source: 'src/lib/components/ui/indicators/IntentMarkLoader.svelte',
  publicImport: '$lib/components/ui/indicators',
  legacyImports: [
    '$lib/components/ui/indicators/AgentBadge.svelte',
    '$lib/components/ui/indicators/UnsavedIndicator.svelte',
  ],
  exports: [
    'IntentMarkLoader',
    'AgentBadge',
    'IntentMarkVariant',
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
    'src/lib/components/chat/ThinkingBlock.svelte',
    'src/lib/components/chat/TypingIndicator.svelte',
    'src/lib/components/chat/input/SimpleRichInput.svelte',
    'src/lib/components/chat/streaming-status-utils.ts',
    'src/lib/components/notes/primitives/AgentActionBlock.svelte',
    'src/lib/components/ui/button/button.svelte',
    'src/lib/components/ui/list/ListItem.svelte',
    'src/lib/components/workspace/initializer/BranchSelector.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/indicators/IntentMarkLoader.test.ts',
  removalGate:
    'Retain IntentMarkLoader as the only indeterminate indicator while canonical callers, deterministic motion tests, and loading catalog coverage pass; AgentBadge and UnsavedIndicator remain internal product exports and are not catalog entries.',
  dynamicImports: [],
  fixtures: spinnerFixtures,
  useWhen: [
    'Use bloom for buttons, list rows, thinking blocks, live-stream phases, typing, hierarchy cards, message navigation, and content previews; streaming status keeps its status-derived bloom, pulse, or twist variant.',
  ],
});
