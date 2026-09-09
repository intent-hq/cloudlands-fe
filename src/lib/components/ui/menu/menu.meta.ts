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
    'CheckboxGroup',
    'CheckboxItem',
    'CommandItem',
    'Content',
    'Item',
    'Menu',
    'MenuItem',
    'MenuSub',
    'Portal',
    'RadioGroup',
    'RadioItem',
    'Root',
    'Separator',
    'StackedContent',
    'StackedMenuGroup',
    'StackedMenuItem',
    'Sub',
    'SubContent',
    'SubTrigger',
    'Trigger',
    'menuMetadata',
    'menuSemantics',
  ],
  category: 'primitive',
  owner: '007-B5',
  callers: [
    'src/features/external-editors/components/FileActionsDropdown.svelte',
    'src/features/external-editors/components/OpenComboButton.svelte',
    'src/features/layout/components/ViewSettingsDropdown.svelte',
    'src/lib/components/chat/RegularAgentWelcome.svelte',
    'src/lib/components/chat/input/SimpleRichInput.svelte',
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
    'Retain the compatibility wrapper until all 16 callers migrate and canonical keyboard and focus tests pass.', // i18n-ignore (design-system catalog metadata)
  dynamicImports: [],
  fixtures: menuFixtures,
} satisfies UiComponentMetadata;
