/**
 * Mention token registry: the one place that defines how a mention is saved
 * as text and every way that text is read back.
 *
 * The composer saves a mention as a text token (`toPromptToken`). Several
 * readers turn that text back into something: the chat bubble, the composer
 * and note-editor chip injectors, plain-text previews and the chip click
 * handlers. Each used to carry its own copy of the token grammar, and the
 * copies drifted (cloudlands-fe#3845: note titles saved, ids read back cut at
 * the first space). Every reader now gets its patterns, parsing and chip
 * attributes from this module, so a mention type is defined once.
 *
 * - `MENTION_SERIALIZERS` / `toPromptToken`: candidate → token text.
 * - `MENTION_TOKEN_ENTRIES`: one entry per token form (current and legacy),
 *   with the pattern, the surfaces that read it and its parser.
 * - `scanMentions(text, surface)`: ordered, non-overlapping matches. The
 *   earliest match wins; at the same position the entry listed first wins.
 * - `mentionElement(parsed)`: the chip element (attributes, class, text) both
 *   injectors emit; `mentionPreviewText(parsed)`: the `@<label>` previews use.
 *
 * Surfaces:
 * - `chat`: chat bubbles. `@` must not follow an email-local-part character,
 *   and paths only chip when written with `@`.
 * - `markdown`: the composer and note-editor chip injectors, which also chip
 *   bare file names and paths, `intent://` note links and workspace note paths.
 * - `preview`: plain-text previews (queued messages, agent cards).
 *
 * The module is DOM-free so it can run in a Web Worker. The per-type token
 * modules (note-, runtime- and member-mention-token.ts) keep each format's
 * exact parser; nothing else may define mention patterns
 * (registry-guard.test.ts).
 */

import {
  MEMBER_MENTION_BODY_SOURCE,
  memberMentionLabel,
  parseMemberMention,
  serializeMemberMention,
} from '$lib/utils/member-mention-token';
import {
  NOTE_MENTION_BODY_SOURCE,
  noteMentionChipAttrs,
  parseNoteMention,
  serializeNoteMention,
  type NoteMention,
} from '$lib/utils/note-mention-token';
import {
  parseRuntimeMention,
  RUNTIME_MENTION_BODY_SOURCE,
  runtimeMentionChipAttrs,
  serializeRuntimeMention,
  type RuntimeMention,
} from '$lib/utils/runtime-mention-token';
import { parseFilePathLineSuffix } from '$shared/utils/link-helpers';
import type { MentionCandidate, MentionType } from './types';

// ---------------------------------------------------------------------------
// Save: candidate → token text
// ---------------------------------------------------------------------------

type SerializableMention = Pick<MentionCandidate, 'type' | 'id' | 'label' | 'meta'>;
type Serializer = (item: SerializableMention) => string;

function stripLeadingAt(path: string | null | undefined): string {
  if (!path) return '';
  return path.startsWith('@') ? path.slice(1) : path;
}

/**
 * Line suffixes a path token may carry: `:12`, `:12:3`, `:L3-7`, `#L3-7`,
 * `#L3C5`; the forms `parseFilePathLineSuffix` splits off.
 */
const PATH_SUFFIX_SOURCE = String.raw`(?::L\d+(?:-\d+)?|:\d+(?::\d+)?|#L\d+(?:-\d+|C\d+)?)`;
const PATH_SUFFIX_RE = new RegExp(`^${PATH_SUFFIX_SOURCE}$`);

function rawMeta(item: SerializableMention): Record<string, any> {
  return (item.meta || {}) as Record<string, any>;
}

function pathOf(item: SerializableMention): string {
  const meta = rawMeta(item);
  return stripLeadingAt(meta.fullPath || meta.path || meta.filename || item.label || item.id);
}

/** `:L<a>-<b>` for a composer range; otherwise the suffix a chip was read with. */
function pathSuffixOf(item: SerializableMention): string {
  const meta = rawMeta(item);
  if (meta.range) return `:L${meta.range.start}-${meta.range.end}`;
  return typeof meta.lineSuffix === 'string' && PATH_SUFFIX_RE.test(meta.lineSuffix)
    ? meta.lineSuffix
    : '';
}

const serializeFile: Serializer = (item) => `@${pathOf(item)}${pathSuffixOf(item)}`;
const serializeFolder: Serializer = (item) => `@${pathOf(item)}`;

/** Tokens saved as `@<promptToken>` (specialists, commands, everything else). */
function promptTokenSerializer(fallback?: string): Serializer {
  return (item) => {
    const meta = rawMeta(item);
    const raw = fallback
      ? meta.promptToken || item.id || item.label || fallback
      : meta.promptToken || meta.path || item.label || item.id;
    return `@${stripLeadingAt(raw)}`;
  };
}

const serializeNote: Serializer = (item) => {
  // `@note[(<workspaceId>/)<id>:<title>]`: the id is authoritative for
  // lookup/navigation, the title keeps the token readable.
  const meta = rawMeta(item);
  const token = serializeNoteMention({
    id: stripLeadingAt(item.id),
    title: item.label || item.id,
    workspaceId: meta.isExternalLink === true ? meta.workspaceId : undefined,
  });
  // No token-safe id: emit the title as plain text rather than a
  // whitespace-truncated `@note/<title>` chip pointing at the wrong note.
  return token ?? (item.label || item.id || '');
};

function serializeRuntime(kind: 'terminal' | 'script'): Serializer {
  return (item) => {
    // `@terminal[<id>:<name>]` / `@script[<id>:<name>]`.
    const name = stripLeadingAt(item.label || item.id || kind);
    // No token-safe id: emit the name as plain text rather than a token
    // that readers would cut short.
    return serializeRuntimeMention({ kind, id: item.id, name }) ?? name;
  };
}

const serializeRule: Serializer = (item) => {
  // Expect meta.path to be relative like .intent/rules/<file>.md or .augment/rules/<file>.md
  const relPath = stripLeadingAt(rawMeta(item).path || item.label || item.id);
  const norm =
    relPath.startsWith('.intent/') || relPath.startsWith('.augment/')
      ? relPath
      : `.intent/rules/${relPath}`;
  return `@${norm}`;
};

const serializeOther = promptTokenSerializer();

/** How each mention type is saved. Typed as a full record so a new type must choose. */
export const MENTION_SERIALIZERS: Record<MentionType, Serializer> = {
  member: (item) => serializeMemberMention(item),
  file: serializeFile,
  'file-range': serializeFile,
  folder: serializeFolder,
  'source-folder': serializeFolder,
  rule: serializeRule,
  personality: promptTokenSerializer('auggie-personality-agent-default'),
  note: serializeNote,
  terminal: serializeRuntime('terminal'),
  script: serializeRuntime('script'),
  specialist: promptTokenSerializer('specialist'),
  command: promptTokenSerializer('command'),
  'note-range': serializeOther,
  'external-source': serializeOther,
  task: serializeOther,
  'user-guidelines': serializeOther,
  workspace: serializeOther,
  agent: serializeOther,
  symbol: serializeOther,
  branch: serializeOther,
  commit: serializeOther,
  pr: serializeOther,
  'linear-issue': serializeOther,
  'github-issue': serializeOther,
  group: serializeOther,
};

/** Save a mention as its prompt token. */
export function toPromptToken(item: SerializableMention): string {
  const serialize = MENTION_SERIALIZERS[item.type as MentionType] ?? serializeOther;
  return serialize(item);
}

// ---------------------------------------------------------------------------
// Read: token text → parsed mention
// ---------------------------------------------------------------------------

export type MentionSurface = 'chat' | 'markdown' | 'preview';

/** An attached-context mention (`@context[...]`: Linear, GitHub, Sentry, browser). */
export interface ContextMention {
  itemType: string;
  provider: string;
  identifier: string;
  title: string;
  url?: string;
  description?: string;
  metadata?: string;
}

/** What one token means, before any store lookup or rendering. */
export type ParsedMention =
  | { kind: 'member'; member: MentionCandidate }
  | { kind: 'context'; context: ContextMention }
  /** `token` is `@note[...]`; `legacy` is `@note/<id>` (no saved title). */
  | { kind: 'note'; form: 'token' | 'legacy'; note: NoteMention }
  | { kind: 'note'; form: 'intent-url'; note: NoteMention; url: string; workspaceId: string }
  | { kind: 'note'; form: 'workspace-path'; note: NoteMention; fullPath: string }
  | { kind: 'runtime'; mention: RuntimeMention }
  | { kind: 'rule'; path: string }
  | { kind: 'personality'; token: string }
  | {
      kind: 'path';
      /** The path without any line suffix. */
      path: string;
      /** The matched text without the `@`, suffix included (chip label). */
      target: string;
      line?: number;
      /** Bare file names are stored as `meta.filename`, paths as `meta.fullPath`. */
      metaKey: 'fullPath' | 'filename';
    };

export interface MentionTokenEntry {
  name: string;
  /**
   * Pattern for one token, without flags or capturing groups. For an
   * `@`-led token (`at: true`) it starts after the `@`.
   */
  source: string;
  at: boolean;
  surfaces: readonly MentionSurface[];
  /** Parse the whole matched text (`@` included); null when malformed. */
  parse(text: string): ParsedMention | null;
}

const ALL: readonly MentionSurface[] = ['chat', 'markdown', 'preview'];
const CHAT_AND_MARKDOWN: readonly MentionSurface[] = ['chat', 'markdown'];
const MARKDOWN: readonly MentionSurface[] = ['markdown'];
const CHAT: readonly MentionSurface[] = ['chat'];

const FILE_EXTENSIONS =
  'json|js|ts|tsx|jsx|md|mdx|yaml|yml|svelte|html|css|scss|py|go|rs|rb|java|kt|swift|m|mm|hpp|h|hh|c|cc|cpp|sh|toml|lock|ini|conf|txt|csv|sql';

/**
 * Split a path token's line suffix off. Only a suffix the serializer can
 * write back is split, so a chip always saves the text it was read from.
 */
export function parsePathSuffix(target: string): { path: string; line?: number } {
  const { path, line } = parseFilePathLineSuffix(target);
  if (line === undefined || !PATH_SUFFIX_RE.test(target.slice(path.length)))
    return { path: target };
  return { path, line };
}

function pathMention(
  target: string,
  metaKey: 'fullPath' | 'filename',
): ParsedMention & { kind: 'path' } {
  const { path, line } = parsePathSuffix(target);
  return { kind: 'path', path, target, metaKey, ...(line !== undefined ? { line } : {}) };
}

const CONTEXT_ITEM_TYPES: Record<string, string> = {
  linear: 'linear-issue',
  github: 'github-issue',
  sentry: 'sentry-issue',
  browser: 'browser-url',
};

function decodeBase64Utf8(content: string): string {
  const bytes = Uint8Array.from(atob(content), (character) => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** `@context[<base64 JSON>]`, or the legacy `@context[provider|identifier|title]`. */
function parseContextMention(text: string): ParsedMention {
  const content = text.slice('@context['.length, -1);
  if (/^[A-Za-z0-9+/=]+$/.test(content)) {
    try {
      const json = JSON.parse(decodeBase64Utf8(content));
      if (json && typeof json === 'object') {
        const provider = json.provider || 'browser';
        return {
          kind: 'context',
          context: {
            itemType: json.itemType || CONTEXT_ITEM_TYPES[provider] || 'browser-url',
            provider,
            identifier: json.identifier || '',
            title: json.title || '',
            ...(json.url ? { url: String(json.url) } : {}),
            ...(json.description ? { description: String(json.description) } : {}),
            ...(json.metadata ? { metadata: String(json.metadata) } : {}),
          },
        };
      }
    } catch {
      // Not base64 JSON: read it as the legacy pipe form.
    }
  }
  let provider = 'browser';
  let identifier: string;
  let title: string;
  const firstPipe = content.indexOf('|');
  const secondPipe = firstPipe === -1 ? -1 : content.indexOf('|', firstPipe + 1);
  if (secondPipe !== -1) {
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
  return {
    kind: 'context',
    context: {
      itemType: CONTEXT_ITEM_TYPES[provider] || 'browser-url',
      provider,
      identifier,
      title,
    },
  };
}

/** `intent://local/note/<id>` or `intent://local/<workspaceId>/note/<id>`; other links are not mentions. */
function parseIntentNoteUrl(url: string): ParsedMention | null {
  try {
    const parsed = new URL(url.replace('intent://', 'http://'));
    const segments = parsed.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
    let id = '';
    let workspaceId = '';
    if (segments[0] === 'note' && segments[1]) {
      id = segments[1];
    } else if (segments[1] === 'note' && segments[2]) {
      workspaceId = segments[0];
      id = segments[2];
    }
    if (!id) return null;
    return { kind: 'note', form: 'intent-url', note: { id, title: id }, url, workspaceId };
  } catch {
    return null;
  }
}

/** `@context[...]` attachments; also used to strip them from previews. */
const CONTEXT_ENTRY: MentionTokenEntry = {
  name: 'context',
  // Base64 JSON; the legacy pipe form whose title may hold one level of
  // brackets; or, for older tokens with an unbalanced `[`, anything to the first `]`.
  source: String.raw`context\[(?:[A-Za-z0-9+/=]+|[^[\]]*(?:\[[^\]]*\][^[\]]*)*|[^\]]*)\]`,
  at: true,
  surfaces: CHAT_AND_MARKDOWN,
  parse: parseContextMention,
};

/**
 * Every token form, in precedence order (earlier wins at the same position):
 * member, note, terminal/script, legacy note, then the path heuristics.
 */
export const MENTION_TOKEN_ENTRIES: readonly MentionTokenEntry[] = [
  {
    name: 'member',
    source: MEMBER_MENTION_BODY_SOURCE,
    at: true,
    surfaces: ALL,
    parse: (text) => {
      const member = parseMemberMention(text);
      return member ? { kind: 'member', member } : null;
    },
  },
  {
    name: 'note',
    source: NOTE_MENTION_BODY_SOURCE,
    at: true,
    surfaces: ALL,
    parse: (text) => {
      const note = parseNoteMention(text);
      return note ? { kind: 'note', form: 'token', note } : null;
    },
  },
  {
    name: 'runtime',
    source: RUNTIME_MENTION_BODY_SOURCE,
    at: true,
    surfaces: ALL,
    parse: (text) => {
      const mention = parseRuntimeMention(text);
      return mention ? { kind: 'runtime', mention } : null;
    },
  },
  {
    name: 'legacy-note',
    source: String.raw`note\/[A-Za-z0-9_-]+`,
    at: true,
    surfaces: CHAT_AND_MARKDOWN,
    parse: (text) => {
      const id = text.slice('@note/'.length);
      return { kind: 'note', form: 'legacy', note: { id, title: id } };
    },
  },
  {
    name: 'rule',
    source: String.raw`\.augment\/rules\/[^\s<>()'"]+`,
    at: true,
    surfaces: MARKDOWN,
    parse: (text) => ({ kind: 'rule', path: text.slice(1) }),
  },
  {
    name: 'absolute-path',
    // Greedy to the next delimiter; parsePathSuffix splits any line suffix.
    source: String.raw`\/[^\s<>()'"]+`,
    at: true,
    surfaces: MARKDOWN,
    parse: (text) => pathMention(text.slice(1), 'fullPath'),
  },
  {
    name: 'relative-path',
    source: String.raw`[A-Za-z0-9._-]+\/[^\s<>()'"]+\.[A-Za-z0-9]+${PATH_SUFFIX_SOURCE}?`,
    at: true,
    surfaces: MARKDOWN,
    // Drop stray `@` at segment starts (left by an old double-`@` bug).
    parse: (text) =>
      pathMention(
        text
          .slice(1)
          .split('/')
          .map((segment) => (segment.startsWith('@') ? segment.slice(1) : segment))
          .join('/'),
        'fullPath',
      ),
  },
  {
    name: 'file-name',
    source: String.raw`[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+${PATH_SUFFIX_SOURCE}?`,
    at: true,
    surfaces: MARKDOWN,
    parse: (text) => pathMention(text.slice(1), 'filename'),
  },
  {
    name: 'bare-file-name',
    source: String.raw`\b[A-Za-z0-9][A-Za-z0-9._-]+\.(?:${FILE_EXTENSIONS})\b${PATH_SUFFIX_SOURCE}?`,
    at: false,
    surfaces: MARKDOWN,
    parse: (text) => pathMention(text, 'filename'),
  },
  {
    name: 'bare-path',
    source: String.raw`\b[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\.(?:${FILE_EXTENSIONS})\b${PATH_SUFFIX_SOURCE}?`,
    at: false,
    surfaces: MARKDOWN,
    parse: (text) => pathMention(text, 'fullPath'),
  },
  {
    name: 'personality',
    source: String.raw`auggie-personality-[\w-]+`,
    at: true,
    surfaces: MARKDOWN,
    parse: (text) => ({ kind: 'personality', token: text.slice(1) }),
  },
  {
    name: 'workspace-note-path',
    source: String.raw`\/[^\s<>()'"]*(?:intent|\.workspaces)\/[a-f0-9-]+\/\.workspace\/notes\/[a-f0-9-]+\.json`,
    at: false,
    surfaces: MARKDOWN,
    parse: (text) => {
      const id = /\/([a-f0-9-]+)\.json$/.exec(text)?.[1];
      return id
        ? { kind: 'note', form: 'workspace-path', note: { id, title: id }, fullPath: text }
        : null;
    },
  },
  {
    name: 'intent-url',
    source: String.raw`intent:\/\/[^\s<>()'"]+`,
    at: false,
    surfaces: MARKDOWN,
    parse: parseIntentNoteUrl,
  },
  CONTEXT_ENTRY,
  {
    // Chat chips any `@`-led token with a file extension.
    name: 'chat-file',
    source: String.raw`[^\s@]+\.[a-zA-Z]+${PATH_SUFFIX_SOURCE}?`,
    at: true,
    surfaces: CHAT,
    parse: (text) => pathMention(text.slice(1), 'fullPath'),
  },
  {
    // ...and any `@`-led token with a `/` (folders, extensionless files).
    name: 'chat-path',
    source: String.raw`[^\s@]*\/[^\s]+`,
    at: true,
    surfaces: CHAT,
    parse: (text) => pathMention(text.slice(1), 'fullPath'),
  },
];

/**
 * Chat: the `@` must not follow an email-local-part character, so
 * `clement@shv.com` and `https://user@host/path` stay plain text while
 * `(@note/spec)` still chips.
 */
const AT_GUARD: Record<MentionSurface, string> = {
  chat: '(?<![A-Za-z0-9._%+-])',
  markdown: '',
  preview: '',
};

interface SurfaceScanner {
  regex: RegExp;
  entries: MentionTokenEntry[];
}

const scanners = new Map<MentionSurface, SurfaceScanner>();

function scannerFor(surface: MentionSurface): SurfaceScanner {
  let scanner = scanners.get(surface);
  if (!scanner) {
    const entries = MENTION_TOKEN_ENTRIES.filter((entry) => entry.surfaces.includes(surface));
    const alternatives = entries.map(
      (entry) => `(${entry.at ? `${AT_GUARD[surface]}@` : ''}(?:${entry.source}))`,
    );
    scanner = { regex: new RegExp(alternatives.join('|'), 'g'), entries };
    scanners.set(surface, scanner);
  }
  return scanner;
}

export interface MentionMatch {
  /** Index of the match in the scanned text. */
  index: number;
  /** The matched text as it appears in the scanned text. */
  text: string;
  entry: MentionTokenEntry;
  /** Null when the text looks like a token but does not parse; keep it as text. */
  parsed: ParsedMention | null;
}

export interface ScanOptions {
  /** Applied to the matched text before parsing (e.g. HTML entity decoding). */
  decode?: (text: string) => string;
}

/** Find every mention token `surface` reads, in order, without overlaps. */
export function scanMentions(
  text: string,
  surface: MentionSurface,
  options: ScanOptions = {},
): MentionMatch[] {
  const { regex, entries } = scannerFor(surface);
  const matches: MentionMatch[] = [];
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const group = match.findIndex((value, i) => i > 0 && value !== undefined);
    const entry = entries[group - 1];
    const raw = match[0];
    const decoded = options.decode ? options.decode(raw) : raw;
    matches.push({ index: match.index, text: raw, entry, parsed: entry.parse(decoded) });
    if (raw.length === 0) regex.lastIndex++;
  }
  return matches;
}

/** Whether `text` holds anything the `surface` readers would turn into a mention. */
export function hasMentionToken(text: string, surface: MentionSurface): boolean {
  const { regex } = scannerFor(surface);
  regex.lastIndex = 0;
  const found = regex.test(text);
  regex.lastIndex = 0;
  return found;
}

// ---------------------------------------------------------------------------
// Chips and previews
// ---------------------------------------------------------------------------

/** The `data-*` attributes of a mention chip (`<span data-mention>`). */
export interface MentionChipAttrs {
  type: string;
  id?: string;
  label: string;
  uri?: string;
  meta?: Record<string, unknown>;
}

/** Chip attributes for a parsed mention; null for context mentions, which use their own element. */
export function mentionChipAttrs(parsed: ParsedMention): MentionChipAttrs | null {
  switch (parsed.kind) {
    case 'member': {
      const { type, id, label, uri, meta } = parsed.member;
      return { type, id, label, uri, meta: meta as Record<string, unknown> | undefined };
    }
    case 'context':
      return null;
    case 'note':
      switch (parsed.form) {
        case 'token':
          return noteMentionChipAttrs(parsed.note);
        case 'legacy':
          return { type: 'note', id: parsed.note.id, label: parsed.note.id };
        case 'intent-url':
          return {
            type: 'note',
            id: parsed.note.id,
            label: parsed.note.id,
            uri: parsed.url,
            meta: {
              workspaceId: parsed.workspaceId,
              fullUrl: parsed.url,
              isExternalLink: !!parsed.workspaceId,
            },
          };
        case 'workspace-path':
          return {
            type: 'note',
            id: parsed.note.id,
            label: parsed.note.id,
            meta: { fullPath: parsed.fullPath },
          };
      }
      return null;
    case 'runtime':
      return runtimeMentionChipAttrs(parsed.mention);
    case 'rule':
      return {
        type: 'rule',
        id: parsed.path,
        label: parsed.path.split('/').pop() || parsed.path,
        meta: { path: parsed.path },
      };
    case 'personality':
      return {
        type: 'personality',
        id: parsed.token,
        label: parsed.token,
        meta: { promptToken: parsed.token },
      };
    case 'path': {
      const lineSuffix = parsed.target.slice(parsed.path.length);
      return {
        type: 'file',
        id: parsed.path,
        label: parsed.target,
        meta: {
          [parsed.metaKey]: parsed.path,
          ...(parsed.line !== undefined ? { line: parsed.line } : {}),
          ...(lineSuffix ? { lineSuffix } : {}),
        },
      };
    }
  }
}

/** One element to emit: the injectors build it as an HTML string or as DOM. */
export interface MentionElement {
  /** In emit order; values are unescaped. */
  attributes: Array<[string, string]>;
  className: string;
  text: string;
}

/** The chip (or context-mention) element a parsed mention becomes in rich text. */
export function mentionElement(parsed: ParsedMention): MentionElement | null {
  if (parsed.kind === 'context') {
    const { context } = parsed;
    const attributes: Array<[string, string]> = [
      ['data-type', 'context-mention'],
      ['data-item-type', context.itemType],
      ['data-provider', context.provider],
      ['data-title', context.title],
      ['data-identifier', context.identifier],
    ];
    if (context.url) attributes.push(['data-url', context.url]);
    if (context.description) attributes.push(['data-description', context.description]);
    if (context.metadata) attributes.push(['data-metadata', context.metadata]);
    return {
      attributes,
      className: 'context-mention',
      text: context.title || context.identifier || 'Link',
    };
  }
  const chip = mentionChipAttrs(parsed);
  if (!chip) return null;
  const attributes: Array<[string, string]> = [
    ['data-mention', 'true'],
    ['data-type', chip.type],
  ];
  if (chip.id) attributes.push(['data-id', chip.id]);
  attributes.push(['data-label', chip.label]);
  if (chip.uri) attributes.push(['data-uri', chip.uri]);
  attributes.push(['data-meta', JSON.stringify(chip.meta || {})]);
  return {
    attributes,
    className: 'mention-chip',
    text: chip.type === 'member' ? memberMentionLabel(chip.label) : chip.label,
  };
}

/** The `@<label>` a plain-text preview shows; null keeps the token text. */
function mentionPreviewText(parsed: ParsedMention): string | null {
  switch (parsed.kind) {
    case 'member':
      return memberMentionLabel(parsed.member.label);
    case 'note':
      return parsed.form === 'token' ? `@${parsed.note.title}` : null;
    case 'runtime':
      return `@${parsed.mention.name}`;
    default:
      return null;
  }
}

/**
 * Plain-text previews (queued messages, agent cards): render each persisted
 * member, note, terminal and script token as the `@<label>` its chip shows.
 */
export function mentionTokensToText(text: string): string {
  let out = '';
  let last = 0;
  for (const match of scanMentions(text, 'preview')) {
    const preview = match.parsed ? mentionPreviewText(match.parsed) : null;
    if (preview === null) continue;
    out += text.slice(last, match.index) + preview;
    last = match.index + match.text.length;
  }
  return out + text.slice(last);
}

/** Whether `text` holds a parseable mention of `kind` (e.g. a workspace member). */
export function hasParsedMention(
  text: string,
  surface: MentionSurface,
  kind: ParsedMention['kind'],
): boolean {
  return scanMentions(text, surface).some((match) => match.parsed?.kind === kind);
}

const CONTEXT_TOKEN_GLOBAL = new RegExp(`@(?:${CONTEXT_ENTRY.source})`, 'g');

/** Remove attached-context tokens (previews show the attachment elsewhere). */
export function stripContextMentions(text: string): string {
  return text.replace(CONTEXT_TOKEN_GLOBAL, '');
}
