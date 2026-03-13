// Prompt token formatting utilities for mentions
// Matches VSCode chat webview canonical @-token style

import type { MentionCandidate, MentionType } from './types';

/**
 * Helper to strip leading @ from a path if present
 */
function stripLeadingAt(path: string | null | undefined): string {
  if (!path) return '';
  return path.startsWith('@') ? path.slice(1) : path;
}

export function toPromptToken(
  item: Pick<MentionCandidate, 'type' | 'id' | 'label' | 'meta'>,
): string {
  const type = item.type as MentionType;
  const meta = item.meta || ({} as any);

  switch (type) {
    case 'file':
    case 'file-range': {
      const rawPath: string = meta.fullPath || meta.path || item.label || item.id;
      const fullPath = stripLeadingAt(rawPath);
      const range = meta.range ? `:L${meta.range.start}-${meta.range.end}` : '';
      return `@${fullPath}${range}`;
    }
    case 'folder':
    case 'source-folder': {
      const rawPath: string = meta.fullPath || meta.path || item.label || item.id;
      const fullPath = stripLeadingAt(rawPath);
      return `@${fullPath}`;
    }
    case 'rule': {
      // Expect meta.path to be relative like .augment/rules/<file>.md
      const relPath: string = stripLeadingAt(meta.path || item.label || item.id);
      const norm = relPath.startsWith('.augment/') ? relPath : `.augment/rules/${relPath}`;
      return `@${norm}`;
    }
    case 'personality': {
      // Expect meta.promptToken to already be canonical like auggie-personality-agent-default
      const rawToken: string =
        meta.promptToken || item.id || item.label || 'auggie-personality-agent-default';
      const token = stripLeadingAt(rawToken);
      return `@${token}`;
    }
    case 'note': {
      // Use the note's label (title) when available, falling back to ID
      const noteName = stripLeadingAt(item.label || item.id);
      return `@note/${noteName}`;
    }
    case 'terminal': {
      const terminalName = stripLeadingAt(item.label || item.id || 'terminal');
      return `@terminal/${terminalName}`;
    }
    case 'script': {
      const scriptName = stripLeadingAt(item.label || item.id || 'script');
      return `@script/${scriptName}`;
    }
    case 'specialist': {
      const rawToken = meta.promptToken || item.id || item.label || 'specialist';
      const token = stripLeadingAt(rawToken);
      return `@${token}`;
    }
    case 'command': {
      // Special commands (e.g. user-guidelines)
      const rawToken = meta.promptToken || item.id || item.label || 'command';
      const token = stripLeadingAt(rawToken);
      return `@${token}`;
    }
    default: {
      const rawToken = meta.promptToken || meta.path || item.label || item.id;
      const token = stripLeadingAt(rawToken);
      return `@${token}`;
    }
  }
}
