/**
 * Utility to parse stored message text into editable components.
 *
 * Stored messages contain context prefixes like:
 * - [Currently viewing: Spec]\n```\n{content}\n```\n\n
 * - [Currently viewing file: path/to/file]\n```\n{content}\n```\n\n
 * - [Currently viewing note: Title]\n```\n{content}\n```\n\n
 * - [Selected text:\n```\n{text}\n```]\n\n
 *
 * This utility extracts these into structured context items and clean user message.
 */

import type { ContextItem } from '$lib/components/chat/input/context-api';
import { m } from '$shared/paraglide/messages.js';
import { DOCK_EVIDENCE_CONTEXT_HEADER } from '$shared/dock-evidence';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const point = (value: unknown): boolean =>
  Array.isArray(value) && value.length === 2 && value.every(finite);

function evidenceGeometry(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.kind === 'rect')
    return (
      finite(value.x) &&
      finite(value.y) &&
      finite(value.w) &&
      finite(value.h) &&
      value.w >= 0 &&
      value.h >= 0
    );
  if (value.kind === 'arrow') return point(value.tail) && point(value.head);
  return (
    value.kind === 'path' &&
    Array.isArray(value.points) &&
    value.points.length > 0 &&
    value.points.length <= 16 &&
    value.points.every(point)
  );
}

function evidenceBody(value: unknown): boolean {
  if (
    !record(value) ||
    value.type !== 'dock_screen_evidence' ||
    value.version !== 1 ||
    !Array.isArray(value.images) ||
    value.images.length > 4
  )
    return false;
  const numbers = new Set<number>();
  for (const [index, image] of value.images.entries()) {
    if (
      !record(image) ||
      image.image !== index + 1 ||
      !Array.isArray(image.size) ||
      image.size.length !== 2 ||
      !image.size.every((n) => positive(n) && Number.isSafeInteger(n)) ||
      !positive(image.scale) ||
      !Array.isArray(image.marks)
    )
      return false;
    for (const mark of image.marks) {
      if (
        !record(mark) ||
        !positive(mark.n) ||
        !Number.isSafeInteger(mark.n) ||
        mark.n > 99 ||
        numbers.has(mark.n) ||
        !['pick', 'box', 'pen', 'arrow'].includes(String(mark.tool)) ||
        !evidenceGeometry(mark.geometry)
      )
        return false;
      numbers.add(mark.n);
      if (mark.element !== undefined) {
        const element = mark.element;
        if (
          !record(element) ||
          typeof element.role !== 'string' ||
          typeof element.name !== 'string' ||
          ![element.role, element.name, element.path, element.source].every(
            (s) => s === null || (typeof s === 'string' && s.length <= 512),
          )
        )
          return false;
      }
    }
  }
  if (Array.from(numbers).some((n) => n > numbers.size)) return false;
  const validClip = (clip: unknown): boolean =>
    record(clip) &&
    (clip.attachment_id === null ||
      (typeof clip.attachment_id === 'string' && clip.attachment_id.length > 0)) &&
    finite(clip.duration_ms) &&
    clip.duration_ms >= 0 &&
    clip.duration_ms <= 120_000 &&
    typeof clip.has_mic_audio === 'boolean' &&
    record(clip.mark_timestamps_ms) &&
    Object.entries(clip.mark_timestamps_ms).every(
      ([n, time]) =>
        /^[1-9]\d*$/.test(n) &&
        numbers.has(Number(n)) &&
        finite(time) &&
        time >= 0 &&
        time <= (clip.duration_ms as number),
    );
  // Recordings: clips (numbered 1..n in start order); clip is the older single form.
  if (value.clip !== undefined && !validClip(value.clip)) return false;
  if (value.clips !== undefined) {
    if (
      !Array.isArray(value.clips) ||
      value.clips.length === 0 ||
      value.clips.length > 8 ||
      !value.clips.every(
        (clip, index) => validClip(clip) && (clip as Record<string, unknown>).clip === index + 1,
      )
    )
      return false;
  }
  return value.images.length > 0 || value.clip !== undefined || value.clips !== undefined;
}

/**
 * Recognize only the producer's four-line, versioned context block at the current
 * prefix boundary. Never scan user prose/fences or swallow a later closing fence.
 * This is text parsing, not provenance authentication: an exact copy of a valid
 * prefix is indistinguishable from generated context without message metadata.
 */
export function consumeDockEvidencePrefix(
  text: string,
  options: {
    /**
     * The message's own metadata says it carries dock screen evidence: the exact
     * header and one json fence of that type are the producer's, even when the body
     * has a newer shape than this validator knows. Never set from text alone.
     */
    trusted?: boolean;
  } = {},
): { prefix: string; remaining: string } | null {
  const opening = `${DOCK_EVIDENCE_CONTEXT_HEADER}\n\`\`\`json\n`;
  if (!text.startsWith(opening)) return null;
  const end = text.indexOf('\n', opening.length);
  if (end < 0 || end - opening.length > 262_144 || text.slice(end, end + 4) !== '\n```')
    return null;
  const after = end + 4;
  if (after !== text.length && !text.startsWith('\n\n', after)) return null;
  const json = text.slice(opening.length, end);
  try {
    const body: unknown = JSON.parse(json);
    const producer = options.trusted
      ? record(body) && body.type === 'dock_screen_evidence'
      : evidenceBody(body) && JSON.stringify(body) === json;
    if (!producer) return null;
  } catch {
    return null;
  }
  return { prefix: text.slice(0, after), remaining: text.slice(after).replace(/^\n+/, '') };
}

/**
 * Preserve only retained screen context during edit/regenerate. Screenshot
 * numbers refer to immutable pixels: removing/reordering a referenced image
 * cannot safely be repaired by renumbering the text. Null keeps the edit open.
 */
export function restoreDockEvidenceForEdit(
  originalItems: readonly ContextItem[],
  items: readonly ContextItem[],
  userText: string,
): string | null {
  const retained = items.filter((item) => item.metadata?.kind === 'dock_screen_evidence');
  if (!retained.length) return userText;
  if (retained.length !== 1) return null;
  const item = retained[0];
  const original = originalItems.find((candidate) => candidate.id === item.id);
  if (!item.content || original?.content !== item.content) return null;
  const parsed = consumeDockEvidencePrefix(item.content);
  if (!parsed || parsed.remaining) return null;
  // The strict consumer has already validated this exact compact body.
  const body = JSON.parse(parsed.prefix.split('\n')[2]) as {
    images: unknown[];
    clip?: { attachment_id: string | null };
    clips?: { attachment_id: string | null }[];
  };
  const images = (source: readonly ContextItem[]) =>
    source.filter(
      (candidate) => candidate.imageMimeType && (candidate.attachmentId || candidate.imageData),
    );
  const originalImages = images(originalItems);
  const editedImages = images(items);
  const imageIdentity = (image: ContextItem) =>
    JSON.stringify([image.id, image.attachmentId, image.imageData, image.imageMimeType]);
  if (
    originalImages.length < body.images.length ||
    editedImages.length < body.images.length ||
    originalImages
      .slice(0, body.images.length)
      .some((image, index) => imageIdentity(image) !== imageIdentity(editedImages[index]))
  )
    return null;
  for (const clip of body.clips ?? (body.clip ? [body.clip] : [])) {
    const id = clip.attachment_id;
    const hasClip = (source: readonly ContextItem[]) =>
      source.some((candidate) => candidate.attachmentId === id && !candidate.imageMimeType);
    if (!id || !hasClip(originalItems) || !hasClip(items)) return null;
  }
  return `${parsed.prefix}\n\n${userText}`;
}

export interface ParsedMessage {
  contextItems: ContextItem[];
  userMessage: string;
}

interface ContextPattern {
  regex: RegExp;
  type: 'file' | 'note' | 'spec' | 'selection';
  getContextItem: (match: RegExpMatchArray) => ContextItem;
}

const contextPatterns: ContextPattern[] = [
  {
    // Spec context with optional code block content
    regex: /^\[Currently viewing: Spec\](?:\n```[^\n]*\n([\s\S]*?)\n```)?\n*/,
    type: 'spec',
    getContextItem: (match) => ({
      id: `edit-spec-${Date.now()}`,
      type: 'note',
      label: 'Spec', // i18n-ignore (note identifier)
      description: m.chat_storedContext_spec_description(),
      content: match[1] || undefined,
      metadata: { kind: 'spec', noteId: 'spec' },
    }),
  },
  {
    // File context with optional code block content
    regex: /^\[Currently viewing file: ([^\]]+)\](?:\n```[^\n]*\n([\s\S]*?)\n```)?\n*/,
    type: 'file',
    getContextItem: (match) => ({
      id: `edit-file-${Date.now()}`,
      type: 'file',
      label: match[1].split('/').pop() || match[1],
      description: match[1],
      path: match[1],
      content: match[2] || undefined,
    }),
  },
  {
    // Diff context
    regex: /^\[Currently viewing diff for: ([^\]]+)\](?:\n```[^\n]*\n([\s\S]*?)\n```)?\n*/,
    type: 'file',
    getContextItem: (match) => ({
      id: `edit-diff-${Date.now()}`,
      type: 'file',
      label: match[1].split('/').pop() || match[1],
      description: m.chat_storedContext_diffFor_label({ path: match[1] }),
      path: match[1],
      content: match[2] || undefined,
      metadata: { kind: 'diff' },
    }),
  },
  {
    // Note context with optional code block content
    regex: /^\[Currently viewing note: ([^\]]+)\](?:\n```[^\n]*\n([\s\S]*?)\n```)?\n*/,
    type: 'note',
    getContextItem: (match) => ({
      id: `edit-note-${Date.now()}`,
      type: 'note',
      label: match[1],
      description: 'Note',
      content: match[2] || undefined,
    }),
  },
  {
    // Selected text with source file
    regex: /^\[Selected text from ([^\]:]+):\n```\n([\s\S]*?)\n```\]\n*/,
    type: 'selection',
    getContextItem: (match) => ({
      id: `edit-selection-${Date.now()}`,
      type: 'selection',
      label: m.chat_storedContext_selectionFrom_label({ file: match[1].split('/').pop() ?? '' }),
      description: match[1],
      content: match[2],
      path: match[1],
    }),
  },
  {
    // Selected text without source
    regex: /^\[Selected text:\n```\n([\s\S]*?)\n```\]\n*/,
    type: 'selection',
    getContextItem: (match) => ({
      id: `edit-selection-${Date.now()}`,
      type: 'selection',
      label: `"${match[1].substring(0, 30)}${match[1].length > 30 ? '...' : ''}"`,
      content: match[1],
    }),
  },
  {
    // Selected text from chat input
    regex: /^\[Selected text from chat input:\n```\n([\s\S]*?)\n```\]\n*/,
    type: 'selection',
    getContextItem: (match) => ({
      id: `edit-selection-${Date.now()}`,
      type: 'selection',
      label: `"${match[1].substring(0, 30)}${match[1].length > 30 ? '...' : ''}"`,
      content: match[1],
    }),
  },
];

/**
 * Parse a stored message into context items and clean user message.
 */
export function parseStoredMessage(
  text: string,
  /** The message metadata marks dock evidence: its exact prefix is the producer's. */
  options: { trustedEvidence?: boolean } = {},
): ParsedMessage {
  const contextItems: ContextItem[] = [];
  let remaining = text;

  // Keep parsing until no more context patterns match
  let foundMatch = true;
  while (foundMatch) {
    foundMatch = false;
    const evidence = consumeDockEvidencePrefix(remaining, {
      trusted: options.trustedEvidence,
    });
    if (evidence) {
      contextItems.push({
        id: `edit-screen-evidence-${contextItems.length}`,
        type: 'selection',
        label: m.annotation_feedback_heading(),
        content: evidence.prefix,
        metadata: { kind: 'dock_screen_evidence', version: 1 },
      });
      remaining = evidence.remaining;
      foundMatch = true;
      continue;
    }
    for (const pattern of contextPatterns) {
      const match = remaining.match(pattern.regex);
      if (match) {
        foundMatch = true;
        contextItems.push(pattern.getContextItem(match));
        remaining = remaining.replace(pattern.regex, '');
        break;
      }
    }
  }

  return {
    contextItems,
    userMessage: remaining.trim(),
  };
}
