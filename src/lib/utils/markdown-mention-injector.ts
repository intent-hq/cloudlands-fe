/**
 * Pure string-based mention injection for HTML.
 *
 * Converts canonical @-tokens to <span data-mention> elements so TipTap
 * re-parses them as mention nodes.
 *
 * This module is intentionally free of DOM dependencies so it can run in
 * a Web Worker as well as on the main thread.
 */

// --- Regex patterns ---
const noteRe = /@note\/([A-Za-z0-9\-_]+)/g;
const rulesRe = /@\.augment\/rules\/[^\s<>()'\"]+/g;
const fileRe = /@\/[^\s<>()'\"]+/g;
const relativeFileRe = /@([A-Za-z0-9._-]+\/[^\s<>()'\"]+\.[A-Za-z0-9]+)/g;
const personaRe = /@auggie\-personality\-[\w\-]+/g;
const simpleFileNameRe = /@([A-Za-z0-9._-]+\.[A-Za-z0-9._-]+)/g;
const bareFileNameRe =
  /\b([A-Za-z0-9][A-Za-z0-9._-]+\.(?:json|js|ts|tsx|jsx|md|mdx|yaml|yml|svelte|html|css|scss|py|go|rs|rb|java|kt|swift|m|mm|hpp|h|hh|c|cc|cpp|sh|toml|lock|ini|conf|txt|csv|sql))\b/g;
const barePathRe =
  /\b([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\.(?:json|js|ts|tsx|jsx|md|mdx|yaml|yml|svelte|html|css|scss|py|go|rs|rb|java|kt|swift|m|mm|hpp|h|hh|c|cc|cpp|sh|toml|lock|ini|conf|txt|csv|sql))\b/g;
const workspaceNotePathRe =
  /\/[^\s<>()'\"]*(?:intent|\.workspaces)\/[a-f0-9-]+\/\.workspace\/notes\/([a-f0-9-]+)\.json/g;
const intentUrlRe = /intent:\/\/[^\s<>()'\"]+/g;
const contextMentionRe = /@context\[([A-Za-z0-9+/=]+|[^\[\]]*(?:\[[^\]]*\][^\[\]]*)*)\]/g;

const allPatterns: Array<{ re: RegExp; kind: string }> = [
  { re: noteRe, kind: 'note' },
  { re: rulesRe, kind: 'rule' },
  { re: fileRe, kind: 'file' },
  { re: relativeFileRe, kind: 'relative-file' },
  { re: simpleFileNameRe, kind: 'simple-file' },
  { re: bareFileNameRe, kind: 'bare-file' },
  { re: barePathRe, kind: 'bare-path' },
  { re: personaRe, kind: 'personality' },
  { re: workspaceNotePathRe, kind: 'workspace-note-path' },
  { re: intentUrlRe, kind: 'intent-url' },
  { re: contextMentionRe, kind: 'context-mention' },
];

// --- Helper: escape HTML attribute values ---
const escAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- Helper: build mention span HTML string ---
function mentionSpanHtml(attrs: {
  type: string;
  id?: string;
  label: string;
  meta?: unknown;
  uri?: string;
}): string {
  let s = `<span data-mention="true" data-type="${escAttr(attrs.type)}"`;
  if (attrs.id) s += ` data-id="${escAttr(attrs.id)}"`;
  s += ` data-label="${escAttr(attrs.label)}"`;
  if (attrs.uri) s += ` data-uri="${escAttr(attrs.uri)}"`;
  s += ` data-meta="${escAttr(JSON.stringify(attrs.meta || {}))}"`;
  s += ` class="mention-chip">${escAttr(attrs.label)}</span>`;
  return s;
}

// --- Helper: build context mention span HTML string ---
function contextSpanHtml(attrs: {
  itemType: string;
  provider: string;
  title: string;
  identifier: string;
  url?: string;
  description?: string;
  metadata?: string;
  displayLabel: string;
}): string {
  let s = `<span data-type="context-mention"`;
  s += ` data-item-type="${escAttr(attrs.itemType)}"`;
  s += ` data-provider="${escAttr(attrs.provider)}"`;
  s += ` data-title="${escAttr(attrs.title)}"`;
  s += ` data-identifier="${escAttr(attrs.identifier)}"`;
  if (attrs.url) s += ` data-url="${escAttr(attrs.url)}"`;
  if (attrs.description) s += ` data-description="${escAttr(attrs.description)}"`;
  if (attrs.metadata) s += ` data-metadata="${escAttr(attrs.metadata)}"`;
  s += ` class="context-mention">${escAttr(attrs.displayLabel)}</span>`;
  return s;
}

// --- Convert a match to its replacement HTML ---
function matchToHtml(
  kind: string,
  value: string,
  groups: string[],
): string {
  if (kind === 'note') {
    const id = groups[0] || '';
    return mentionSpanHtml({ type: 'note', id, label: id });
  } else if (kind === 'rule') {
    const path = value.slice(1);
    const label = path.split('/').pop() || path;
    return mentionSpanHtml({ type: 'rule', id: path, label, meta: { path } });
  } else if (kind === 'file') {
    const fullPath = value.slice(1);
    return mentionSpanHtml({ type: 'file', id: fullPath, label: fullPath, meta: { fullPath } });
  } else if (kind === 'relative-file') {
    const rawPath = groups[0] || value.slice(1);
    const fullPath = rawPath
      .split('/')
      .map((seg: string) => (seg.startsWith('@') ? seg.slice(1) : seg))
      .join('/');
    return mentionSpanHtml({ type: 'file', id: fullPath, label: fullPath, meta: { fullPath } });
  } else if (kind === 'simple-file') {
    const rawFilename = groups[0] || value.slice(1);
    const filename = rawFilename.startsWith('@') ? rawFilename.slice(1) : rawFilename;
    return mentionSpanHtml({ type: 'file', id: filename, label: filename, meta: { filename } });
  } else if (kind === 'bare-file') {
    const rawFilename = groups[0] || '';
    const filename = rawFilename.startsWith('@') ? rawFilename.slice(1) : rawFilename;
    if (filename) {
      return mentionSpanHtml({ type: 'file', id: filename, label: filename, meta: { filename } });
    }
    return value; // no match — keep original text
  } else if (kind === 'bare-path') {
    const fullPath = groups[0] || value;
    if (fullPath) {
      return mentionSpanHtml({ type: 'file', id: fullPath, label: fullPath, meta: { fullPath } });
    }
    return value;
  } else if (kind === 'personality') {
    const token = value.slice(1);
    return mentionSpanHtml({ type: 'personality', id: token, label: token, meta: { promptToken: token } });
  } else if (kind === 'workspace-note-path') {
    const noteId = groups[0] || '';
    if (noteId) {
      return mentionSpanHtml({ type: 'note', id: noteId, label: noteId, meta: { fullPath: value } });
    }
    return ''; // skip the path
  } else if (kind === 'intent-url') {
    const url = value;
    try {
      const parsed = new URL(url.replace('intent://', 'http://'));
      const segments = parsed.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
      let resourceType = 'unknown';
      let resourceId = '';
      let workspaceId = '';
      if (segments[0] === 'note' && segments[1]) {
        resourceType = 'note';
        resourceId = segments[1];
      } else if (segments[1] === 'note' && segments[2]) {
        workspaceId = segments[0];
        resourceType = 'note';
        resourceId = segments[2];
      }
      if (resourceType === 'note' && resourceId) {
        return mentionSpanHtml({
          type: 'note',
          id: resourceId,
          label: resourceId,
          uri: url,
          meta: { workspaceId, fullUrl: url, isExternalLink: !!workspaceId },
        });
      }
      return escAttr(value); // unknown format — plain text
    } catch {
      return escAttr(value); // invalid URL — plain text
    }
  } else if (kind === 'context-mention') {
    const content = groups[0] || '';
    let provider = 'browser';
    let identifier = '';
    let title = '';
    let url = '';
    let description = '';
    let metadata = '';
    let itemType = '';
    const isBase64 = /^[A-Za-z0-9+/=]+$/.test(content) && !content.includes('|');
    if (isBase64) {
      try {
        const json = decodeURIComponent(escape(atob(content)));
        const parsed = JSON.parse(json);
        provider = parsed.provider || 'browser';
        identifier = parsed.identifier || '';
        title = parsed.title || '';
        url = parsed.url || '';
        description = parsed.description || '';
        metadata = parsed.metadata || '';
        itemType = parsed.itemType || '';
      } catch {
        // fall through to legacy
      }
    }
    if (!itemType) {
      const firstPipe = content.indexOf('|');
      const secondPipe = content.indexOf('|', firstPipe + 1);
      if (firstPipe !== -1 && secondPipe !== -1) {
        provider = content.substring(0, firstPipe) || 'browser';
        identifier = content.substring(firstPipe + 1, secondPipe);
        title = content.substring(secondPipe + 1);
      } else if (firstPipe !== -1) {
        provider = content.substring(0, firstPipe) || 'browser';
        identifier = content.substring(firstPipe + 1);
        title = identifier;
      } else {
        identifier = content;
        title = content;
      }
      const providerToItemType: Record<string, string> = {
        linear: 'linear-issue',
        github: 'github-issue',
        sentry: 'sentry-issue',
        browser: 'browser-url',
      };
      itemType = providerToItemType[provider] || 'browser-url';
    }
    return contextSpanHtml({
      itemType,
      provider,
      title,
      identifier,
      url,
      description,
      metadata,
      displayLabel: title || identifier || 'Link',
    });
  }
  return value;
}

// --- Process a text segment: find earliest match, replace, repeat ---
function processText(text: string): string {
  let idx = 0;
  const parts: string[] = [];

  while (idx < text.length) {
    let best: { start: number; end: number; kind: string; value: string; groups: string[] } | null = null;

    for (const { re, kind } of allPatterns) {
      re.lastIndex = 0;
      const m = re.exec(text.slice(idx));
      if (m) {
        const start = idx + m.index;
        const end = idx + m.index + m[0].length;
        if (!best || start < best.start) {
          best = { start, end, kind, value: m[0], groups: m.slice(1) };
        }
      }
    }

    if (!best) {
      // No more matches — append rest of text
      parts.push(text.slice(idx));
      break;
    }

    // Append text before match
    if (best.start > idx) {
      parts.push(text.slice(idx, best.start));
    }

    // Append replacement
    parts.push(matchToHtml(best.kind, best.value, best.groups));
    idx = best.end;
  }

  return parts.join('');
}

// --- Blocked tags whose content should not be processed ---
const BLOCK_TAGS = new Set(['code', 'pre', 'script', 'style', 'a']);

/**
 * Inject mention chips into HTML by converting canonical @-tokens to
 * `<span data-mention>` elements so TipTap re-parses them as mention nodes.
 *
 * - Skips inside code/pre/script/style/a tags and existing data-mention spans
 * - Pure string-based implementation (no DOM required) for performance
 */
export function injectMentionSpans(html: string): string {
  const result: string[] = [];
  let i = 0;
  // Stack of open blocked tags (lowercase tag names)
  const blockStack: string[] = [];

  while (i < html.length) {
    if (html[i] === '<') {
      // Find end of tag
      const tagEnd = html.indexOf('>', i);
      if (tagEnd === -1) {
        // Malformed — append rest as-is
        result.push(html.slice(i));
        break;
      }
      const tag = html.slice(i, tagEnd + 1);

      // Check if this is a closing tag
      const closeMatch = tag.match(/^<\/\s*([a-zA-Z][a-zA-Z0-9]*)/);
      if (closeMatch) {
        const tagName = closeMatch[1].toLowerCase();
        // Pop from block stack if it matches
        if (blockStack.length > 0 && blockStack[blockStack.length - 1] === tagName) {
          blockStack.pop();
        }
        result.push(tag);
        i = tagEnd + 1;
        continue;
      }

      // Check if this is an opening tag
      const openMatch = tag.match(/^<\s*([a-zA-Z][a-zA-Z0-9]*)/);
      if (openMatch) {
        const tagName = openMatch[1].toLowerCase();
        const isSelfClosing = tag.endsWith('/>');
        const isBlocked =
          BLOCK_TAGS.has(tagName) ||
          tag.includes('data-mention');

        if (isBlocked && !isSelfClosing) {
          blockStack.push(tagName);
        }
      }

      result.push(tag);
      i = tagEnd + 1;
    } else {
      // Text content — find the next tag
      const nextTag = html.indexOf('<', i);
      const textEnd = nextTag === -1 ? html.length : nextTag;
      const text = html.slice(i, textEnd);

      if (blockStack.length === 0 && text.length > 0) {
        // Not inside a blocked region — process mentions
        result.push(processText(text));
      } else {
        result.push(text);
      }
      i = textEnd;
    }
  }

  return result.join('');
}
