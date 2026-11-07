import {
  faAt,
  faChartLine,
  faCog,
  faCommentDots,
  faFile,
  faFileAlt,
  faFlask,
  faFolderOpen,
  faFolderTree,
  faGlobe,
  faPaperclip,
  faPlay,
  faTerminal,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons';
import { m } from '$shared/paraglide/messages.js';

export const COMMAND_PALETTE_COMMANDS = [
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
    id: 'enable-experimental-remote-agents',
    get label() {
      return m.lib_commandPalette_enableExperimentalRemoteAgents_label();
    },
    icon: faFlask,
  },
  {
    id: 'disable-experimental-remote-agents',
    get label() {
      return m.lib_commandPalette_disableExperimentalRemoteAgents_label();
    },
    icon: faFlask,
  },
  {
    id: 'enable-experimental-plain-folders',
    get label() {
      return m.lib_commandPalette_enableExperimentalPlainFolders_label();
    },
    icon: faFlask,
  },
  {
    id: 'disable-experimental-plain-folders',
    get label() {
      return m.lib_commandPalette_disableExperimentalPlainFolders_label();
    },
    icon: faFlask,
  },
  {
    id: 'enable-experimental-tab-groups',
    get label() {
      return m.lib_commandPalette_enableExperimentalTabGroups_label();
    },
    icon: faFlask,
  },
  {
    id: 'disable-experimental-tab-groups',
    get label() {
      return m.lib_commandPalette_disableExperimentalTabGroups_label();
    },
    icon: faFlask,
  },
  {
    id: 'enable-experimental-machine-rail',
    get label() {
      return m.lib_commandPalette_enableExperimentalMachineRail_label();
    },
    icon: faFlask,
  },
  {
    id: 'disable-experimental-machine-rail',
    get label() {
      return m.lib_commandPalette_disableExperimentalMachineRail_label();
    },
    icon: faFlask,
  },
  {
    id: 'enable-experimental-cloud-machines',
    get label() {
      return m.lib_commandPalette_enableExperimentalCloudMachines_label();
    },
    icon: faFlask,
  },
  {
    id: 'disable-experimental-cloud-machines',
    get label() {
      return m.lib_commandPalette_disableExperimentalCloudMachines_label();
    },
    icon: faFlask,
  },
  {
    id: 'enable-experimental-ssh-machine-setup',
    get label() {
      return m.lib_commandPalette_enableExperimentalSshMachineSetup_label();
    },
    icon: faFlask,
  },
  {
    id: 'disable-experimental-ssh-machine-setup',
    get label() {
      return m.lib_commandPalette_disableExperimentalSshMachineSetup_label();
    },
    icon: faFlask,
  },
  {
    id: 'group-tabs-by-project',
    get label() {
      return m.layout_workspaceTabGroup_groupByProject_label();
    },
    icon: faFolderTree,
  },
  {
    id: 'enable-experimental-browser-access',
    get label() {
      return m.lib_commandPalette_enableExperimentalBrowserAccess_label();
    },
    icon: faFlask,
  },
  {
    id: 'disable-experimental-browser-access',
    get label() {
      return m.lib_commandPalette_disableExperimentalBrowserAccess_label();
    },
    icon: faFlask,
  },
  {
    id: 'enable-experimental-dock',
    get label() {
      return m.lib_commandPalette_enableExperimentalDock_label();
    },
    icon: faFlask,
  },
  {
    id: 'disable-experimental-dock',
    get label() {
      return m.lib_commandPalette_disableExperimentalDock_label();
    },
    icon: faFlask,
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
    id: 'open-dev-console',
    get label() {
      return m.devConsole_title_label();
    },
    icon: faTerminal,
    shortcut: '',
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
