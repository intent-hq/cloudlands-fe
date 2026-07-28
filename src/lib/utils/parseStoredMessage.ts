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
export function parseStoredMessage(text: string): ParsedMessage {
  const contextItems: ContextItem[] = [];
  let remaining = text;

  // Keep parsing until no more context patterns match
  let foundMatch = true;
  while (foundMatch) {
    foundMatch = false;
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
