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
    'ActionRow',
    'CheckboxGroup',
    'CheckboxItem',
    'CommandItem',
    'Content',
    'Group',
    'GroupHeading',
    'Indicator',
    'Item',
    'Label',
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
    'getPageTargetIndex',
    'menuItem',
    'menuMetadata',
    'menuOverlay',
    'menuSemantics',
  ],
  // Minimal composition from the menu-command-states default fixture.
  usage: `<script lang="ts">
  import * as Menu from '$lib/components/ui/menu';

  let selected = $state('');
</script>

<Menu.Root>
  <Menu.Trigger>Open menu</Menu.Trigger>
  <Menu.Content>
    <Menu.Group>
      <Menu.Label>Commands</Menu.Label>
      <Menu.Item onSelect={() => (selected = 'Run command')}>Run command</Menu.Item>
    </Menu.Group>
  </Menu.Content>
</Menu.Root>
<p role="status">{selected}</p>`,
  category: 'primitive',
  owner: '007-B5',
  useWhen: [
    'Presenting commands with shared keyboard, focus, and dismissal behavior.',
    'Keeping an unavailable command visible with CommandItem disabledReason; the localized reason disables activation and is linked with aria-describedby.',
  ],
  callers: [
    'src/features/external-editors/components/FileActionsDropdown.svelte',
    'src/features/external-editors/components/OpenComboButton.svelte',
    'src/lib/components/chat/RegularAgentWelcome.svelte',
    'src/lib/components/chat/SpecialistDropdown.svelte',
    'src/lib/components/layout/DaemonStatusIndicator.svelte',
    'src/lib/components/layout/panel-system/PanelTabBar.svelte',
    'src/lib/components/modals/PullConflictDialog.svelte',
    'src/lib/components/notes/primitives/DiagramBlock.svelte',
    'src/lib/components/workspace/WorkspaceSidebarHeader.svelte',
    'src/lib/components/workspace/initializer/InitialAgentPicker.svelte',
    'src/lib/components/workspace/sidebar/WorkspaceProgressCard.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/menu/menu.test.ts',
  removalGate:
    'Retain the compatibility wrapper until all callers migrate and canonical keyboard and focus tests pass.', // i18n-ignore (design-system catalog metadata)
  dynamicImports: [],
  fixtures: menuFixtures,
} satisfies UiComponentMetadata;
