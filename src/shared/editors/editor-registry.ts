/**
 * Editor Registry
 *
 * Defines all known editors/IDEs that can be auto-detected and used to open files/folders.
 * This is the single source of truth for editor configurations.
 *
 * Cross-platform support:
 * - macOS: Uses appName to find .app bundles in /Applications
 * - Linux: Uses platforms.linux binaries/flatpakIds for detection
 * - Windows: Uses platforms.win32 binaries for detection via `where` command
 */

export type EditorCategory = 'ide' | 'terminal' | 'finder';

export interface EditorDefinition {
  /** Unique identifier - used for cross-platform binary mapping */
  id: string;
  /** Display name */
  name: string;
  /** Short label for compact UI */
  shortLabel: string;
  /** macOS app name (for detection and opening on macOS) */
  appName: string;
  /** Category for grouping in UI. 'finder' maps to file managers on Linux */
  category: EditorCategory;
  /**
   * Handler type:
   * - 'generic': Uses `open -a "AppName" path` on macOS, direct binary on Linux
   * - 'vscode': Uses VS Code's CLI for better file-in-folder support
   * - 'jetbrains': Uses JetBrains Toolbox detection
   * - 'xcode': Uses Xcode's special project detection (macOS only)
   * - 'finder': Uses Finder's reveal functionality on macOS, xdg-open on Linux
   */
  handlerType: 'generic' | 'vscode' | 'jetbrains' | 'xcode' | 'finder';
  /** Optional: Bundle identifier for more reliable detection (macOS only) */
  bundleId?: string;
  /** Optional: Keyboard shortcut hint */
  shortcut?: string;
  /** Priority for sorting (lower = higher priority) */
  priority: number;
  /** Optional: Whether this editor is macOS-only (e.g., Xcode) */
  macOSOnly?: boolean;
  /** Optional: Whether this editor is Windows-only (e.g., PowerShell, Windows Terminal) */
  win32Only?: boolean;
  /** Optional: Platform-specific detection data */
  platforms?: {
    linux?: {
      /** Binary names to search for in common paths (e.g. ['code', 'code-oss']) */
      binaries?: string[];
      /** Flatpak application IDs (e.g. ['com.visualstudio.code']) */
      flatpakIds?: string[];
    };
    win32?: {
      /** Binary names to search for on PATH via `where` command (e.g. ['code', 'code.cmd']) */
      binaries?: string[];
      /** Platform-specific display name (e.g., 'File Explorer' instead of 'Finder') */
      name?: string;
      /** Platform-specific short label (e.g., 'Explorer' instead of 'Finder') */
      shortLabel?: string;
    };
  };
}

/**
 * Registry of all known editors.
 * Add new editors here - they will be auto-detected if installed.
 */
export const EDITOR_REGISTRY: EditorDefinition[] = [
  // File manager (Finder on macOS, nautilus/dolphin/etc on Linux)
  {
    id: 'finder',
    name: 'Finder',
    shortLabel: 'Finder',
    appName: 'Finder',
    category: 'finder',
    handlerType: 'finder',
    bundleId: 'com.apple.finder',
    shortcut: '⌘O',
    priority: 0,
    platforms: {
      linux: {
        binaries: ['nautilus', 'dolphin', 'thunar', 'nemo', 'pcmanfm'],
      },
      win32: {
        binaries: ['explorer'],
        name: 'File Explorer',
        shortLabel: 'Explorer',
      },
    },
  },

  // IDEs - ordered by popularity
  {
    id: 'vscode',
    name: 'VS Code',
    shortLabel: 'VS Code',
    appName: 'Visual Studio Code',
    category: 'ide',
    handlerType: 'vscode',
    bundleId: 'com.microsoft.VSCode',
    priority: 10,
    platforms: {
      linux: {
        binaries: ['code', 'code-oss'],
        flatpakIds: ['com.visualstudio.code', 'com.visualstudio.code.oss'],
      },
      win32: {
        binaries: ['code', 'code.cmd'],
      },
    },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    shortLabel: 'Cursor',
    appName: 'Cursor',
    category: 'ide',
    handlerType: 'generic',
    bundleId: 'com.todesktop.230313mzl4w4u92',
    priority: 11,
    platforms: {
      linux: {
        binaries: ['cursor'],
        flatpakIds: ['com.cursor.Cursor'],
      },
      win32: {
        binaries: ['cursor', 'cursor.cmd'],
      },
    },
  },
  {
    id: 'zed',
    name: 'Zed',
    shortLabel: 'Zed',
    appName: 'Zed',
    category: 'ide',
    handlerType: 'generic',
    bundleId: 'dev.zed.Zed',
    priority: 12,
    platforms: {
      linux: {
        binaries: ['zed', 'zeditor'],
        flatpakIds: ['dev.zed.Zed'],
      },
      win32: {
        binaries: ['zed', 'zed.exe'],
      },
    },
  },
  {
    id: 'xcode',
    name: 'Xcode',
    shortLabel: 'Xcode',
    appName: 'Xcode',
    category: 'ide',
    handlerType: 'xcode',
    bundleId: 'com.apple.dt.Xcode',
    priority: 20,
    macOSOnly: true,
  },
  // JetBrains IDEs - each one listed separately
  {
    id: 'intellij',
    name: 'IntelliJ IDEA',
    shortLabel: 'IntelliJ',
    appName: 'IntelliJ IDEA',
    category: 'ide',
    handlerType: 'jetbrains',
    priority: 21,
    platforms: {
      linux: {
        binaries: ['idea', 'intellij-idea-ultimate'],
        flatpakIds: ['com.jetbrains.IntelliJ-IDEA-Ultimate'],
      },
      win32: {
        binaries: ['idea64.exe', 'idea.cmd'],
      },
    },
  },
  {
    id: 'intellij-ce',
    name: 'IntelliJ IDEA CE',
    shortLabel: 'IntelliJ CE',
    appName: 'IntelliJ IDEA CE',
    category: 'ide',
    handlerType: 'jetbrains',
    priority: 22,
    platforms: {
      linux: {
        binaries: ['idea-ce', 'intellij-idea-community'],
        flatpakIds: ['com.jetbrains.IntelliJ-IDEA-Community'],
      },
      win32: {
        binaries: ['idea64.exe', 'idea.cmd'],
      },
    },
  },
  {
    id: 'webstorm',
    name: 'WebStorm',
    shortLabel: 'WebStorm',
    appName: 'WebStorm',
    category: 'ide',
    handlerType: 'jetbrains',
    priority: 23,
    platforms: {
      linux: {
        binaries: ['webstorm'],
        flatpakIds: ['com.jetbrains.WebStorm'],
      },
      win32: {
        binaries: ['webstorm64.exe', 'webstorm.cmd'],
      },
    },
  },
  {
    id: 'pycharm',
    name: 'PyCharm',
    shortLabel: 'PyCharm',
    appName: 'PyCharm',
    category: 'ide',
    handlerType: 'jetbrains',
    priority: 24,
    platforms: {
      linux: {
        binaries: ['pycharm', 'pycharm-professional'],
        flatpakIds: ['com.jetbrains.PyCharm-Professional'],
      },
      win32: {
        binaries: ['pycharm64.exe', 'pycharm.cmd'],
      },
    },
  },
  {
    id: 'pycharm-ce',
    name: 'PyCharm CE',
    shortLabel: 'PyCharm CE',
    appName: 'PyCharm CE',
    category: 'ide',
    handlerType: 'jetbrains',
    priority: 25,
    platforms: {
      linux: {
        binaries: ['pycharm-community'],
        flatpakIds: ['com.jetbrains.PyCharm-Community'],
      },
      win32: {
        binaries: ['pycharm64.exe', 'pycharm.cmd'],
      },
    },
  },
  {
    id: 'goland',
    name: 'GoLand',
    shortLabel: 'GoLand',
    appName: 'GoLand',
    category: 'ide',
    handlerType: 'jetbrains',
    priority: 26,
    platforms: {
      linux: {
        binaries: ['goland'],
        flatpakIds: ['com.jetbrains.GoLand'],
      },
      win32: {
        binaries: ['goland64.exe', 'goland.cmd'],
      },
    },
  },
  {
    id: 'phpstorm',
    name: 'PhpStorm',
    shortLabel: 'PhpStorm',
    appName: 'PhpStorm',
    category: 'ide',
    handlerType: 'jetbrains',
    priority: 27,
    platforms: {
      linux: {
        binaries: ['phpstorm'],
        flatpakIds: ['com.jetbrains.PhpStorm'],
      },
      win32: {
        binaries: ['phpstorm64.exe', 'phpstorm.cmd'],
      },
    },
  },
  {
    id: 'rubymine',
    name: 'RubyMine',
    shortLabel: 'RubyMine',
    appName: 'RubyMine',
    category: 'ide',
    handlerType: 'jetbrains',
    priority: 28,
    platforms: {
      linux: {
        binaries: ['rubymine'],
        flatpakIds: ['com.jetbrains.RubyMine'],
      },
      win32: {
        binaries: ['rubymine64.exe', 'rubymine.cmd'],
      },
    },
  },
  {
    id: 'clion',
    name: 'CLion',
    shortLabel: 'CLion',
    appName: 'CLion',
    category: 'ide',
    handlerType: 'jetbrains',
    priority: 29,
    platforms: {
      linux: {
        binaries: ['clion'],
        flatpakIds: ['com.jetbrains.CLion'],
      },
      win32: {
        binaries: ['clion64.exe', 'clion.cmd'],
      },
    },
  },
  {
    id: 'rider',
    name: 'Rider',
    shortLabel: 'Rider',
    appName: 'Rider',
    category: 'ide',
    handlerType: 'jetbrains',
    priority: 30,
    platforms: {
      linux: {
        binaries: ['rider'],
        flatpakIds: ['com.jetbrains.Rider'],
      },
      win32: {
        binaries: ['rider64.exe', 'rider.cmd'],
      },
    },
  },
  {
    id: 'datagrip',
    name: 'DataGrip',
    shortLabel: 'DataGrip',
    appName: 'DataGrip',
    category: 'ide',
    handlerType: 'jetbrains',
    priority: 31,
    platforms: {
      linux: {
        binaries: ['datagrip'],
        flatpakIds: ['com.jetbrains.DataGrip'],
      },
      win32: {
        binaries: ['datagrip64.exe', 'datagrip.cmd'],
      },
    },
  },
  {
    id: 'android-studio',
    name: 'Android Studio',
    shortLabel: 'Android Studio',
    appName: 'Android Studio',
    category: 'ide',
    handlerType: 'jetbrains',
    priority: 32,
    platforms: {
      linux: {
        binaries: ['android-studio', 'studio'],
        flatpakIds: ['com.google.AndroidStudio'],
      },
      win32: {
        binaries: ['studio64.exe', 'studio.cmd'],
      },
    },
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    shortLabel: 'Sublime',
    appName: 'Sublime Text',
    category: 'ide',
    handlerType: 'generic',
    bundleId: 'com.sublimetext.4',
    priority: 40,
    platforms: {
      linux: {
        binaries: ['subl', 'sublime_text'],
        flatpakIds: ['com.sublimetext.three'],
      },
      win32: {
        binaries: ['subl', 'subl.exe'],
      },
    },
  },
  {
    id: 'nova',
    name: 'Nova',
    shortLabel: 'Nova',
    appName: 'Nova',
    category: 'ide',
    handlerType: 'generic',
    bundleId: 'com.panic.Nova',
    priority: 41,
    macOSOnly: true,
  },
  {
    id: 'textmate',
    name: 'TextMate',
    shortLabel: 'TextMate',
    appName: 'TextMate',
    category: 'ide',
    handlerType: 'generic',
    bundleId: 'com.macromates.TextMate',
    priority: 42,
    macOSOnly: true,
  },

  // Terminals
  {
    id: 'warp',
    name: 'Warp',
    shortLabel: 'Warp',
    appName: 'Warp',
    category: 'terminal',
    handlerType: 'generic',
    bundleId: 'dev.warp.Warp-Stable',
    priority: 50,
    platforms: {
      linux: {
        binaries: ['warp-terminal', 'warp'],
      },
      win32: {
        binaries: ['warp', 'warp.exe'],
      },
    },
  },
  {
    id: 'ghostty',
    name: 'Ghostty',
    shortLabel: 'Ghostty',
    appName: 'Ghostty',
    category: 'terminal',
    handlerType: 'generic',
    priority: 51,
    platforms: {
      linux: {
        binaries: ['ghostty'],
        flatpakIds: ['com.mitchellh.ghostty'],
      },
    },
  },
  {
    id: 'iterm',
    name: 'iTerm',
    shortLabel: 'iTerm',
    appName: 'iTerm',
    category: 'terminal',
    handlerType: 'generic',
    bundleId: 'com.googlecode.iterm2',
    priority: 52,
    macOSOnly: true,
  },
  {
    id: 'kitty',
    name: 'kitty',
    shortLabel: 'kitty',
    appName: 'kitty',
    category: 'terminal',
    handlerType: 'generic',
    bundleId: 'net.kovidgoyal.kitty',
    priority: 53,
    platforms: {
      linux: {
        binaries: ['kitty'],
        flatpakIds: ['net.kovidgoyal.kitty'],
      },
    },
  },
  {
    id: 'alacritty',
    name: 'Alacritty',
    shortLabel: 'Alacritty',
    appName: 'Alacritty',
    category: 'terminal',
    handlerType: 'generic',
    bundleId: 'org.alacritty',
    priority: 54,
    platforms: {
      linux: {
        binaries: ['alacritty'],
        flatpakIds: ['org.alacritty.Alacritty'],
      },
      win32: {
        binaries: ['alacritty', 'alacritty.exe'],
      },
    },
  },
  {
    id: 'hyper',
    name: 'Hyper',
    shortLabel: 'Hyper',
    appName: 'Hyper',
    category: 'terminal',
    handlerType: 'generic',
    bundleId: 'co.zeit.hyper',
    priority: 55,
    platforms: {
      linux: {
        binaries: ['hyper'],
        flatpakIds: ['co.zeit.Hyper'],
      },
      win32: {
        binaries: ['hyper', 'hyper.exe'],
      },
    },
  },
  {
    id: 'terminal',
    name: 'Terminal',
    shortLabel: 'Terminal',
    appName: 'Terminal',
    category: 'terminal',
    handlerType: 'generic',
    bundleId: 'com.apple.Terminal',
    priority: 99, // Built-in, always last
    platforms: {
      linux: {
        binaries: ['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm'],
      },
      win32: {
        binaries: ['cmd'],
        name: 'Command Prompt',
        shortLabel: 'CMD',
      },
    },
  },

  // Windows-only terminals
  {
    id: 'powershell',
    name: 'PowerShell',
    shortLabel: 'PowerShell',
    appName: 'PowerShell',
    category: 'terminal',
    handlerType: 'generic',
    priority: 96,
    win32Only: true,
    platforms: {
      win32: {
        binaries: ['pwsh', 'powershell'],
      },
    },
  },
  {
    id: 'windows-terminal',
    name: 'Windows Terminal',
    shortLabel: 'Windows Terminal',
    appName: 'Windows Terminal',
    category: 'terminal',
    handlerType: 'generic',
    priority: 95,
    win32Only: true,
    platforms: {
      win32: {
        binaries: ['wt'],
      },
    },
  },
];
