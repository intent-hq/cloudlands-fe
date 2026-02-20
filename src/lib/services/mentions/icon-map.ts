/**
 * Icon mapping for mention types using Font Awesome icon names
 * These names are used to map to Font Awesome icons in the UI components
 */

export const mentionIconMap = {
  // File types
  file: 'file',
  'file-ts': 'file-code',
  'file-tsx': 'file-code',
  'file-js': 'file-code',
  'file-jsx': 'file-code',
  'file-svelte': 'file-code',
  'file-vue': 'file-code',
  'file-py': 'file-code',
  'file-rs': 'file-code',
  'file-go': 'file-code',
  'file-java': 'file-code',
  'file-cpp': 'file-code',
  'file-c': 'file-code',
  'file-h': 'file-code',
  'file-md': 'file-text',
  'file-json': 'file-json',
  'file-yaml': 'file-json',
  'file-yml': 'file-json',
  'file-toml': 'file-json',
  'file-xml': 'file-json',
  'file-html': 'globe',
  'file-css': 'palette',
  'file-scss': 'palette',
  'file-sass': 'palette',
  'file-less': 'palette',
  'file-sh': 'terminal',
  'file-bash': 'terminal',
  'file-zsh': 'terminal',
  'file-fish': 'terminal',
  'file-ps1': 'terminal',
  'file-bat': 'terminal',
  'file-cmd': 'terminal',
  'file-sql': 'database',
  'file-db': 'database',
  'file-sqlite': 'database',
  'file-env': 'settings',
  'file-config': 'settings',
  'file-ini': 'settings',
  'file-cfg': 'settings',
  'file-conf': 'settings',
  'file-lock': 'lock',
  'file-gitignore': 'git-branch',
  'file-dockerfile': 'box',
  'file-docker': 'box',
  'file-makefile': 'wrench',
  'file-cmake': 'wrench',
  'file-gradle': 'wrench',
  'file-maven': 'wrench',
  'file-package': 'package',
  'file-default': 'file',

  // Folder types
  folder: 'folder',
  'folder-open': 'folder-open',
  'folder-src': 'folder-code',
  'folder-lib': 'folder-code',
  'folder-components': 'folder-code',
  'folder-pages': 'folder-code',
  'folder-api': 'folder-code',
  'folder-utils': 'folder-code',
  'folder-helpers': 'folder-code',
  'folder-services': 'folder-code',
  'folder-models': 'folder-code',
  'folder-controllers': 'folder-code',
  'folder-views': 'folder-code',
  'folder-public': 'folder-open',
  'folder-static': 'folder-open',
  'folder-assets': 'image',
  'folder-images': 'image',
  'folder-img': 'image',
  'folder-icons': 'image',
  'folder-styles': 'palette',
  'folder-css': 'palette',
  'folder-scss': 'palette',
  'folder-tests': 'test-tube',
  'folder-test': 'test-tube',
  'folder-spec': 'test-tube',
  'folder-docs': 'book-open',
  'folder-documentation': 'book-open',
  'folder-config': 'settings',
  'folder-configuration': 'settings',
  'folder-settings': 'settings',
  'folder-node_modules': 'package',
  'folder-vendor': 'package',
  'folder-packages': 'package',
  'folder-dist': 'package-check',
  'folder-build': 'package-check',
  'folder-out': 'package-check',
  'folder-output': 'package-check',

  // Note types
  note: 'sticky-note',
  'note-spec': 'file-text',
  'note-todo': 'list-todo',
  'note-meeting': 'users',
  'note-idea': 'lightbulb',
  'note-draft': 'pen-tool',

  // Task types
  task: 'check-square',
  'task-bug': 'bug',
  'task-feature': 'sparkles',
  'task-improvement': 'trending-up',
  'task-refactor': 'refresh-cw',
  'task-test': 'test-tube',
  'task-docs': 'book-open',

  // Rule types
  rule: 'shield',
  'rule-lint': 'shield-check',
  'rule-format': 'align-left',
  'rule-security': 'shield-alert',

  // Terminal type
  terminal: 'terminal',

  // Command types
  command: 'terminal',
  'command-run': 'play',
  'command-build': 'hammer',
  'command-test': 'test-tube',
  'command-deploy': 'rocket',

  // External types
  external: 'external-link',
  'external-docs': 'book-open',
  'external-api': 'globe',
  'external-github': 'github',
  'external-gitlab': 'gitlab',

  // Personality types
  personality: 'user-tie',
  'personality-senior': 'user-graduate',
  'personality-mentor': 'chalkboard-teacher',
  'personality-concise': 'bolt',
  'personality-creative': 'palette',
  'personality-analytical': 'chart-line',

  // Agent types
  agent: 'robot',
  'agent-active': 'robot',
  'agent-idle': 'robot',
  'agent-busy': 'robot',
  'agent-memories': 'brain',

  // Specialist types
  specialist: 'user-tie',
  'specialist-coordinator': 'chalkboard-teacher',
  'specialist-implementor': 'hammer',
  'specialist-verifier': 'shield-check',
  'specialist-pr-reviewer': 'shield-check',
  'specialist-ui-designer': 'palette',
  'specialist-developer': 'wrench',

  // Group types
  group: 'folder',
  'group-files': 'files',
  'group-folders': 'folders',
  'group-notes': 'sticky-note',
  'group-tasks': 'list-todo',
  'group-rules': 'shield',
  'group-commands': 'terminal',
  'group-external': 'external-link',
  'group-personalities': 'users',
  'group-agents': 'robot',
  'group-specialists': 'user-tie',

  // Default
  default: 'file',
} as const;

export type IconName = (typeof mentionIconMap)[keyof typeof mentionIconMap];

export function getIconForType(type: string, subtype?: string): IconName {
  if (subtype) {
    const key = `${type}-${subtype}` as keyof typeof mentionIconMap;
    if (key in mentionIconMap) {
      return mentionIconMap[key];
    }
  }

  const key = type as keyof typeof mentionIconMap;
  if (key in mentionIconMap) {
    return mentionIconMap[key];
  }

  return mentionIconMap.default;
}

export function getIconForFileExtension(extension: string): IconName {
  const key = `file-${extension.toLowerCase()}` as keyof typeof mentionIconMap;
  if (key in mentionIconMap) {
    return mentionIconMap[key];
  }
  return mentionIconMap['file-default'];
}

export function getIconForFolderName(name: string): IconName {
  const key = `folder-${name.toLowerCase()}` as keyof typeof mentionIconMap;
  if (key in mentionIconMap) {
    return mentionIconMap[key];
  }
  return mentionIconMap.folder;
}
