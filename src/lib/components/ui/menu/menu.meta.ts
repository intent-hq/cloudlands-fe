import type { UiComponentMetadata } from '../component-metadata';
import { menuFixtures } from './menu.fixtures';

export const menuSemantics = {
  interaction: 'command',
  selectionReplacement: '$lib/components/ui/select',
} as const;

export const menuMetadata = {
  id: 'menu',
  source: 'src/lib/components/ui/menu/index.ts',
  publicImport: '$lib/components/ui/menu',
  legacyImports: ['$lib/components/ui/dropdown-menu.svelte'],
  exports: [
    'Root',
    'Trigger',
    'Portal',
    'Content',
    'Item',
    'CheckboxGroup',
    'CheckboxItem',
    'RadioGroup',
    'RadioItem',
    'Sub',
    'SubTrigger',
    'SubContent',
    'Separator',
  ],
  category: 'primitive',
  owner: '007-B5',
  callers: [
    'src/features/external-editors/components/FileActionsDropdown.svelte',
    'src/features/external-editors/components/OpenComboButton.svelte',
    'src/features/layout/components/ViewSettingsDropdown.svelte',
    'src/lib/components/chat/RegularAgentWelcome.svelte',
    'src/lib/components/chat/SpecialistDropdown.svelte',
    'src/lib/components/layout/DaemonStatusIndicator.svelte',
    'src/lib/components/layout/panel-system/LayoutPresetDropdown.svelte',
    'src/lib/components/layout/panel-system/PanelTabBar.svelte',
    'src/lib/components/modals/PullConflictDialog.svelte',
    'src/lib/components/notes/primitives/DiagramBlock.svelte',
    'src/lib/components/settings/ProviderPathConfig.svelte',
    'src/lib/components/workspace/TaskStatusIndicator.svelte',
    'src/lib/components/workspace/WorkspaceSidebarHeader.svelte',
    'src/lib/components/workspace/initializer/InitialAgentPicker.svelte',
    'src/lib/components/workspace/sidebar/WorkspaceProgressCard.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/menu/menu.test.ts',
  removalGate:
    'Retain the compatibility wrapper until all 15 callers migrate and canonical keyboard and focus tests pass.',
  dynamicImports: [],
  fixtures: menuFixtures,
} satisfies UiComponentMetadata;
