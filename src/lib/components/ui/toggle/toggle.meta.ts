import type { UiComponentMetadata } from '../component-metadata';
import { toggleFixtures } from './toggle.fixtures';

export const toggleCompatibilityModes = {
  group: {
    replacement: '$lib/components/ui/toggle-group',
    callers: [
      { path: 'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte', count: 1 },
      { path: 'src/routes/(app)/settings/+page.svelte', count: 3 },
    ],
    staticUsageCount: 4,
    dynamicUsageCount: 0,
    removalGate:
      'Remove only when source-derived static and dynamic variant="group" usage counts both reach zero.',
  },
} as const;

export const toggleMetadata = {
  id: 'toggle',
  source: 'src/lib/components/ui/toggle/index.ts',
  publicImport: '$lib/components/ui/toggle',
  legacyImports: ['$lib/components/ui/toggle/toggle.svelte'],
  exports: ['Toggle'],
  category: 'primitive',
  owner: '007-B2',
  callers: [
    'src/features/log/components/ActivityLogFilters.svelte',
    'src/features/onboarding/OnboardingPage.svelte',
    'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte',
    'src/lib/components/chat/ChatChangesPanel.svelte',
    'src/lib/components/chat/ChatSearch.svelte',
    'src/lib/components/chat/input/ContextPickerButton.svelte',
    'src/lib/components/chat/proposals/BulkProposalItems.svelte',
    'src/lib/components/debug/DebugPanel.svelte',
    'src/lib/components/layout/ConnectBackendModal.svelte',
    'src/lib/components/modals/InterruptedAgentsModal.svelte',
    'src/lib/components/modals/TransferWorkspaceModal.svelte',
    'src/lib/components/notes/NotesPanel.svelte',
    'src/lib/components/settings/AgentBackendSettings.svelte',
    'src/lib/components/settings/AgentFeaturesSettings.svelte',
    'src/lib/components/settings/BackendSyncSettings.svelte',
    'src/lib/components/settings/GitWorkspaceSettings.svelte',
    'src/lib/components/settings/HardwareConsoleSettings.svelte',
    'src/lib/components/settings/LegacyImportSettings.svelte',
    'src/lib/components/settings/ListenTargetSelector.svelte',
    'src/lib/components/settings/McpServersSettings.svelte',
    'src/lib/components/settings/NotificationSettings.svelte',
    'src/lib/components/settings/OpenInAppsSettings.svelte',
    'src/lib/components/settings/RtkSettings.svelte',
    'src/lib/components/settings/WebSocketApiSettings.svelte',
    'src/lib/components/settings/WorkspaceApiSettings.svelte',
    'src/lib/components/settings/mcp/McpServerCard.svelte',
    'src/lib/components/workspace/initializer/BranchSelector.svelte',
    'src/lib/components/workspace/initializer/RepoAndBranchPicker.svelte',
    'src/lib/components/workspace/sidebar/FileChangesSection.svelte',
    'src/lib/components/workspace/sidebar/McpServersSection.svelte',
    'src/lib/components/workspace/sidebar/MergePanel.svelte',
    'src/routes/(app)/settings/+page.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/toggle/toggle.test.ts',
  removalGate:
    'Retain canonical aria-pressed Toggle with compact external-label product enforcement; the group compatibility mode remains measured separately.',
  dynamicImports: [],
  fixtures: toggleFixtures,
} satisfies UiComponentMetadata;
