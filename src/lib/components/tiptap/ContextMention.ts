/**
 * Context Mention Node
 *
 * An inline node that renders context mentions (Linear issues, GitHub issues,
 * Sentry issues, URLs) as clickable pills with provider icons.
 *
 * Example: @[ENG-123](linear://issue/abc123)
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { SvelteNodeViewRenderer } from '$lib/utils/tiptap/svelte-node-view';
import ContextMentionNodeView from './ContextMentionNodeView.svelte';
import type { ContextItemType, ContextProvider } from '$features/context/types';

/**
 * Metadata for context mention hover cards
 * Contains author, assignee, labels, state, and other issue properties
 */
export interface ContextMentionMetadata {
  /** Author/creator of the issue */
  author?: string;
  /** Assignee name */
  assignee?: string;
  /** Issue state (e.g., "In Progress", "open", "resolved") */
  state?: string;
  /** Priority level (1-4 for Linear, string for others) */
  priority?: string;
  /** Labels/tags as comma-separated string */
  labels?: string;
  /** Project or team name */
  project?: string;
  /** Created date as ISO string */
  createdAt?: string;
  /** Updated date as ISO string */
  updatedAt?: string;
  /** For Sentry: error level (error, warning, info) */
  level?: string;
  /** For Sentry: event count */
  count?: string;
  /** For Sentry: affected users count */
  userCount?: string;
  /** For Sentry: culprit (file/function) */
  culprit?: string;
  /** For GitHub PRs: source branch name */
  sourceBranch?: string;
  /** For GitHub PRs: target branch name */
  targetBranch?: string;
}

export interface ContextMentionAttributes {
  /** Type of context item */
  itemType: ContextItemType;
  /** Provider for this item */
  provider: ContextProvider;
  /** Display title */
  title: string;
  /** URL to open when clicked */
  url: string;
  /** Unique identifier (e.g., "ENG-123" for Linear) */
  identifier: string;
  /** Optional ID for linking to context store */
  contextId?: string;
  /** Optional description/body text */
  description?: string;
  /** Optional metadata as JSON string (for author, assignee, labels, etc.) */
  metadata?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    contextMention: {
      /** Insert a context mention at the current position */
      insertContextMention: (attrs: ContextMentionAttributes) => ReturnType;
    };
  }
}

export const ContextMention = Node.create({
  name: 'contextMention',

  inline: true,
  group: 'inline',
  atom: true, // Atomic node - treated as a single unit
  selectable: true,

  addAttributes() {
    return {
      itemType: {
        default: 'browser-url',
        parseHTML: (element) => element.getAttribute('data-item-type'),
        renderHTML: (attributes) => ({ 'data-item-type': attributes.itemType }),
      },
      provider: {
        default: 'browser',
        parseHTML: (element) => element.getAttribute('data-provider'),
        renderHTML: (attributes) => ({ 'data-provider': attributes.provider }),
      },
      title: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-title') || element.textContent,
        renderHTML: (attributes) => ({ 'data-title': attributes.title }),
      },
      url: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-url') || element.getAttribute('href'),
        renderHTML: (attributes) => ({ 'data-url': attributes.url }),
      },
      identifier: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-identifier'),
        renderHTML: (attributes) => ({ 'data-identifier': attributes.identifier }),
      },
      contextId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-context-id'),
        renderHTML: (attributes) => {
          if (!attributes.contextId) return {};
          return { 'data-context-id': attributes.contextId };
        },
      },
      description: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-description'),
        renderHTML: (attributes) => {
          if (!attributes.description) return {};
          return { 'data-description': attributes.description };
        },
      },
      metadata: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-metadata'),
        renderHTML: (attributes) => {
          if (!attributes.metadata) return {};
          return { 'data-metadata': attributes.metadata };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="context-mention"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'context-mention',
        class: 'context-mention',
      }),
      HTMLAttributes.title || HTMLAttributes.identifier || 'Link',
    ];
  },

  addNodeView() {
    return SvelteNodeViewRenderer(ContextMentionNodeView);
  },

  addCommands() {
    return {
      insertContextMention:
        (attrs: ContextMentionAttributes) =>
          ({ commands }) => commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});
