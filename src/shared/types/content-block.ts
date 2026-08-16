import type { Proposal } from './proposal';
import { isProposalKind } from './proposal';
import type { MessageRole } from './agent-message';

export type VideoSource =
  | { kind: 'inline'; data: string; mimeType: string }
  | { kind: 'remote'; url: string; mimeType?: string };

/**
 * Unified ContentBlock Type Definition
 *
 * Single source of truth for all content block types across the application.
 * Supports:
 * - Auggie format: text, tool_use, tool_result, thinking
 * - Structured format: text, code, tool_use, tool_result
 * - ACP format: image, audio, resource (via compatibility layer)
 *
 * Maintains backward compatibility with multiple field name aliases:
 * - text/content (both supported)
 * - name/toolName (both supported)
 * - is_error/isError (both supported)
 * - tool_use_id/toolUseId (both supported)
 */

/**
 * Comprehensive ContentBlock interface supporting all content types
 * and maintaining backward compatibility with legacy field names.
 */
export interface ContentBlock {
  /** Type of content block */
  type:
    | 'text'
    | 'code'
    | 'tool_use'
    | 'tool_result'
    | 'thinking'
    | 'image'
    | 'audio'
    | 'video'
    | 'file'
    | 'nav-link'
    | 'proposal';

  // Common fields
  /** Unique identifier for this block */
  id?: string;
  /** Arbitrary metadata associated with this block */
  metadata?: Record<string, any>;
  /**
   * Canonical wire meta (PROTOCOL §7). System-role transcript notices carry
   * `meta.kind` ("interruption" | "discussion-request" | "blocker-report").
   */
  meta?: Record<string, unknown>;
  /**
   * Opaque delivery metadata folded onto persisted wake-tagged user text
   * blocks by the daemon (e.g. `{ type: 'hook_wake', hookId, hookName,
   * reason }`, PROTOCOL §5.40).
   */
  messageMetadata?: Record<string, unknown>;

  // Navigation link fields
  /** Structured block kind for app navigation links */
  kind?: 'nav-link' | Proposal['kind'];
  /** Internal route/hash target for nav-link blocks */
  target?: string;
  /** User-facing label for nav-link blocks */
  label?: string;

  // Proposal block fields
  /** Structured proposal payload for chat-embedded proposal cards */
  proposal?: Proposal;
  /** Proposal payload when the block itself is a Proposal */
  payload?: Proposal['payload'];
  /** Proposal preview when the block itself is a Proposal */
  preview?: Proposal['preview'];
  /** Tool call ID to invoke when applying this proposal */
  applyToolCallId?: string;

  // Text content fields
  /** Text content (primary field) */
  text?: string;
  /** Text content (legacy alias for backward compatibility) */
  content?: string;

  // Code block fields
  /** Programming language for code blocks */
  language?: string;

  // Tool use fields
  /** Tool name (primary field) */
  name?: string;
  /** Tool name (legacy alias for backward compatibility) */
  toolName?: string;
  /** Tool input parameters */
  input?: Record<string, unknown>;
  /** Tool call ID (legacy alias) */
  toolCallId?: string;

  // Tool result fields
  /** ID of the tool_use block this result corresponds to */
  tool_use_id?: string;
  /** Tool result output */
  output?: any;
  /** Whether the tool call resulted in an error (snake_case) */
  is_error?: boolean;
  /** Whether the tool call resulted in an error (camelCase alias) */
  isError?: boolean;

  // Media fields (for image/audio/file types)
  /** Base64-encoded media data */
  data?: string;
  /** MIME type of media */
  mimeType?: string;
  /** Transcript for audio content */
  transcript?: string;
  /** Normalized source for assistant-produced video content */
  source?: VideoSource;
  /** File name (for file type) */
  fileName?: string;
  /** Attachment-registry UUID for attachment-reference file blocks (no bytes) */
  attachmentId?: string;
  /** Byte length for attachment-reference file blocks */
  size?: number;
}

/**
 * Type guard to check if a value is a ContentBlock
 */
export function isContentBlock(value: any): value is ContentBlock {
  return (
    typeof value === 'object' &&
    value !== null &&
    ((typeof value.type === 'string' &&
      [
        'text',
        'code',
        'tool_use',
        'tool_result',
        'thinking',
        'image',
        'audio',
        'video',
        'file',
        'nav-link',
        'proposal',
      ].includes(value.type)) ||
      (value.kind === 'nav-link' && typeof value.target === 'string') ||
      (isProposalKind(value.kind) && !!value.preview))
  );
}

export type VideoContentBlock = ContentBlock & { type: 'video'; source: VideoSource };

const VIDEO_EXTENSION_PATTERN = /\.(?:mp4|webm|mov|m4v)$/i;
const VIDEO_MIME_PATTERN = /^video\/[a-z0-9][a-z0-9.+-]*$/i;
const REMOTE_VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
  'video/m4v',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getVideoMimeType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const mimeType = value.split(';', 1)[0].trim().toLowerCase();
  return VIDEO_MIME_PATTERN.test(mimeType) ? mimeType : undefined;
}

function getRemoteVideoSource(
  value: unknown,
  mimeValue: unknown,
): Extract<VideoSource, { kind: 'remote' }> | null {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const mimeType = getVideoMimeType(mimeValue);
  const supportedMimeType =
    mimeType && REMOTE_VIDEO_MIME_TYPES.has(mimeType) ? mimeType : undefined;
  if (!supportedMimeType && !VIDEO_EXTENSION_PATTERN.test(url.pathname)) return null;
  return {
    kind: 'remote',
    url: value,
    ...(supportedMimeType ? { mimeType: supportedMimeType } : {}),
  };
}

function videoBlock(
  candidate: Record<string, unknown>,
  source: VideoSource,
  fileName?: unknown,
): VideoContentBlock {
  return {
    type: 'video',
    source,
    ...(typeof candidate.id === 'string' ? { id: candidate.id } : {}),
    ...(isRecord(candidate.metadata) ? { metadata: candidate.metadata } : {}),
    ...(typeof fileName === 'string' && fileName.length > 0 ? { fileName } : {}),
  };
}

function normalizeVideoCandidate(value: unknown): VideoContentBlock | null {
  if (!isRecord(value)) return null;
  const type = value.type;

  if ((type === 'file' || type === 'blob') && typeof value.data === 'string' && value.data) {
    const mimeType = getVideoMimeType(value.mimeType);
    if (mimeType) {
      return videoBlock(value, { kind: 'inline', data: value.data, mimeType }, value.fileName);
    }
  }

  if (type === 'resource' && isRecord(value.resource)) {
    const resource = value.resource;
    const mimeType = getVideoMimeType(resource.mimeType);
    if (mimeType && typeof resource.blob === 'string' && resource.blob) {
      return videoBlock(value, { kind: 'inline', data: resource.blob, mimeType }, resource.name);
    }
    const source = getRemoteVideoSource(resource.uri, resource.mimeType);
    return source ? videoBlock(value, source, resource.name) : null;
  }

  if (type === 'resource_link') {
    const source = getRemoteVideoSource(value.uri, value.mimeType);
    return source ? videoBlock(value, source, value.name) : null;
  }

  if (type === 'file') {
    const source = getRemoteVideoSource(value.url ?? value.uri, value.mimeType);
    return source ? videoBlock(value, source, value.fileName) : null;
  }

  return null;
}

function normalizeNestedVideoBlocks(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  let changed = false;
  const normalized = value.map((item) => {
    const next = normalizeAssistantVideoBlock(item);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? normalized : value;
}

function normalizeAssistantVideoBlock(value: unknown): unknown {
  const video = normalizeVideoCandidate(value);
  if (video) return video;
  if (!isRecord(value) || value.type !== 'tool_result') return value;

  const output = normalizeNestedVideoBlocks(value.output);
  const content = normalizeNestedVideoBlocks(value.content);
  if (output === value.output && content === value.content) return value;
  return { ...value, output, content };
}

/** Normalize supported assistant media shapes without changing wire or user attachment data. */
export function normalizeAgentVideoContentBlocks(
  blocks: readonly ContentBlock[],
  role: MessageRole,
): ContentBlock[] {
  if (role !== 'assistant') return blocks as ContentBlock[];
  let changed = false;
  const normalized = blocks.map((block) => {
    const next = normalizeAssistantVideoBlock(block) as ContentBlock;
    if (next !== block) changed = true;
    return next;
  });
  return changed ? normalized : (blocks as ContentBlock[]);
}

function videoSourceIdentity(source: VideoSource): string {
  return source.kind === 'inline'
    ? `inline:${source.mimeType}:${source.data}`
    : `remote:${source.url}`;
}

/** Keep the first occurrence of each normalized video source, including nested tool results. */
export function dedupeAgentVideoContentBlocks(blocks: readonly ContentBlock[]): ContentBlock[] {
  const seen = new Set<string>();

  function dedupeArray(values: readonly unknown[]): unknown[] {
    let changed = false;
    const result: unknown[] = [];
    for (const value of values) {
      if (isRecord(value) && value.type === 'video' && isRecord(value.source)) {
        const source = value.source as VideoSource;
        const key = videoSourceIdentity(source);
        if (seen.has(key)) {
          changed = true;
          continue;
        }
        seen.add(key);
      }

      if (isRecord(value) && value.type === 'tool_result') {
        const output = Array.isArray(value.output) ? dedupeArray(value.output) : value.output;
        const content = Array.isArray(value.content) ? dedupeArray(value.content) : value.content;
        if (output !== value.output || content !== value.content) {
          result.push({ ...value, output, content });
          changed = true;
          continue;
        }
      }
      result.push(value);
    }
    return changed ? result : (values as unknown[]);
  }

  return dedupeArray(blocks) as ContentBlock[];
}

/**
 * Normalize a ContentBlock to ensure consistent field names
 * Converts legacy field names to primary names
 */
export function normalizeContentBlock(block: any): ContentBlock {
  if (!isContentBlock(block)) {
    throw new Error(`Invalid ContentBlock: ${JSON.stringify(block)}`);
  }

  const normalized: ContentBlock = { ...block };

  if (block.kind === 'nav-link' && !block.type) {
    normalized.type = 'nav-link';
  }

  if (isProposalKind(block.kind) && !block.type) {
    normalized.type = 'proposal';
  }

  if (block.proposal) {
    normalized.proposal = block.proposal;
    normalized.kind = block.proposal.kind;
    normalized.payload = block.proposal.payload;
    normalized.preview = block.proposal.preview;
    normalized.applyToolCallId = block.proposal.applyToolCallId;
  }

  // Normalize text field
  if (block.content && !block.text) {
    normalized.text = block.content;
  }

  // Normalize tool name field
  if (block.toolName && !block.name) {
    normalized.name = block.toolName;
  }

  // Normalize error field
  if (block.isError !== undefined && block.is_error === undefined) {
    normalized.is_error = block.isError;
  }

  // Normalize tool_use_id field
  if (block.toolCallId && !block.tool_use_id) {
    normalized.tool_use_id = block.toolCallId;
  }

  return normalized;
}

/**
 * Normalize an array of ContentBlocks by merging adjacent text blocks.
 *
 * When backend content blocks replace frontend blocks (e.g., on stream completion
 * while the user is on a different workspace), the backend may structure content as
 * many small text blocks (one per text segment between tool calls). The frontend
 * normally accumulates text into fewer, larger blocks during streaming.
 *
 * This function merges adjacent text blocks into single blocks so the renderer
 * doesn't display fragmented text snippets between tool call cards.
 */
export function normalizeContentBlocks(blocks: ContentBlock[]): ContentBlock[] {
  if (!blocks || blocks.length <= 1) return blocks;

  const result: ContentBlock[] = [];
  // Helper to get text from a block, handling both `text` and legacy `content` alias
  const getText = (b: ContentBlock) => b.text || b.content || '';

  for (const block of blocks) {
    const last = result[result.length - 1];
    if (block.type === 'text' && last?.type === 'text') {
      // Merge adjacent text blocks, stripping stale legacy `content` field

      const { content: _lastContent, ...lastWithoutContent } = last;
      result[result.length - 1] = {
        ...lastWithoutContent,
        text: getText(last) + getText(block),
      };
    } else {
      result.push({ ...block });
    }
  }
  return result;
}
