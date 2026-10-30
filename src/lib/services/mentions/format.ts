// Prompt token formatting utilities for mentions
// Matches VSCode chat webview canonical @-token style

import type { MentionCandidate, MentionType } from './types';
import { serializeMemberMention } from '$lib/utils/member-mention-token';
import { serializeNoteMention } from '$lib/utils/note-mention-token';
import { serializeRuntimeMention } from '$lib/utils/runtime-mention-token';

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
    case 'member':
      return serializeMemberMention(item);
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
      // Expect meta.path to be relative like .intent/rules/<file>.md or .augment/rules/<file>.md
      const relPath: string = stripLeadingAt(meta.path || item.label || item.id);
      const norm =
        relPath.startsWith('.intent/') || relPath.startsWith('.augment/')
          ? relPath
          : `.intent/rules/${relPath}`;
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
      // `@note[(<workspaceId>/)<id>:<title>]`: the id is authoritative for
      // lookup/navigation, the title keeps the token readable (agents, chip
      // fallback). Titles may contain spaces, which the legacy whitespace-
      // delimited `@note/<x>` form cannot carry.
      const crossWorkspace = meta.isExternalLink === true;
      const token = serializeNoteMention({
        id: stripLeadingAt(item.id),
        title: item.label || item.id,
        workspaceId: crossWorkspace ? meta.workspaceId : undefined,
      });
      // No token-safe id: emit the title as plain text rather than a
      // whitespace-truncated `@note/<title>` chip pointing at the wrong note.
      return token ?? (item.label || item.id || '');
    }
    case 'terminal':
    case 'script': {
      // `@terminal[<id>:<name>]` / `@script[<id>:<name>]`: the id survives and
      // the name may contain spaces, which the legacy `@terminal/<name>` form
      // cut at the first space.
      const name = stripLeadingAt(item.label || item.id || type);
      const token = serializeRuntimeMention({ kind: type, id: item.id, name });
      // No token-safe id: emit the name as plain text rather than a token
      // that readers would cut short.
      return token ?? name;
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
