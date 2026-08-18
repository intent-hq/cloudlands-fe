import {
  faAt,
  faChartLine,
  faCog,
  faCommentDots,
  faFile,
  faFileAlt,
  faFolderOpen,
  faGlobe,
  faPaperclip,
  faPlay,
  faTerminal,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons';
import { m } from '$shared/paraglide/messages.js';
import type { WorkspaceViewMode } from '$store/renderer/slices/tab-state/tab-state-slice';
import { getShortcutDisplay } from '$lib/utils/shortcuts';

export const COMMAND_PALETTE_COMMANDS = (viewMode: WorkspaceViewMode) => [
  {
    id: 'new-workspace',
    get label() {
      return m.lib_commandPalette_newWorkspace_command();
    },
    get pillLabel() {
      return m.lib_commandPalette_workspace_pill();
    },
    icon: faFolderOpen,
    shortcut: '⌘T',
  },
  {
    id: 'settings',
    get label() {
      return m.lib_commandPalette_settings_command();
    },
    icon: faCog,
    shortcut: '⌘,',
  },
  {
    id: 'new-agent',
    get label() {
      return m.lib_commandPalette_newAgentChat_command();
    },
    get pillLabel() {
      return m.lib_commandPalette_agentChat_pill();
    },
    icon: faCommentDots,
  },
  {
    id: 'new-terminal',
    get label() {
      return m.lib_commandPalette_newTerminal_command();
    },
    get pillLabel() {
      return m.lib_commandPalette_terminal_pill();
    },
    icon: faTerminal,
  },
  {
    id: 'new-note',
    get label() {
      return m.lib_commandPalette_newNote_command();
    },
    get pillLabel() {
      return m.lib_commandPalette_note_pill();
    },
    icon: faFileAlt,
  },
  {
    id: 'new-file',
    get label() {
      return m.lib_commandPalette_newFile_command();
    },
    get pillLabel() {
      return m.lib_commandPalette_file_pill();
    },
    icon: faFile,
    shortcut: '⌘N',
  },
  {
    id: 'open-url',
    get label() {
      return m.lib_commandPalette_openUrl_command();
    },
    icon: faGlobe,
  },
  {
    id: 'show-onboarding',
    get label() {
      return m.lib_commandPalette_showOnboarding_command();
    },
    icon: faPlay,
  },
  {
    id: 'workspace-view-mode',
    get label() {
      return viewMode === 'single'
        ? m.lib_commandPalette_switchToHorizontalWorkspaceView_command()
        : m.lib_commandPalette_switchToTabWorkspaceView_command();
    },
    get description() {
      return viewMode === 'single'
        ? m.lib_commandPalette_switchToHorizontalWorkspaceView_description()
        : m.lib_commandPalette_switchToTabWorkspaceView_description();
    },
    icon: faFolderOpen,
    navigationIcon: viewMode === 'single' ? ('spaces' as const) : ('tabs' as const),
    shortcut: getShortcutDisplay('WORKSPACE_VIEW_MODE'),
    // i18n-ignore (non-rendered search aliases)
    searchText: 'tab horizontal stacked columns workspace view layout',
  },
  {
    id: 'enhance-prompt',
    get label() {
      return m.chat_richInput_enhancePrompt_label();
    },
    icon: faWandMagicSparkles,
    shortcut: '⌘/',
  },
  {
    id: 'attach-context',
    get label() {
      return m.lib_commandPalette_attachContext_command();
    },
    icon: faAt,
    shortcut: '@',
  },
  {
    id: 'attach-files',
    get label() {
      return m.chat_richInput_attachFiles_label();
    },
    icon: faPaperclip,
    shortcut: '⇧⌘A',
  },
  {
    id: 'open-hud',
    get label() {
      return m.lib_commandPalette_openHud_command();
    },
    icon: faPlay,
    shortcut: '⇧⌘H',
  },
  {
    id: 'open-usage-stats',
    get label() {
      return m.lib_commandPalette_openUsageStats_command();
    },
    icon: faChartLine,
    shortcut: '⇧⌘U',
  },
];
