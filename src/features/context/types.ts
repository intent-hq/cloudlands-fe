/**
 * Context System Types
 *
 * A unified type system for context items in workspaces. Context items include:
 * - Notes (internal documents)
 * - Linear issues
 * - GitHub issues
 * - Sentry issues
 * - Browser URLs
 *
 * These can be referenced in notes and appear in the context sidebar.
 */

import { m } from '$shared/paraglide/messages.js';

/**
 * Provider identifiers for context items
 */
export type ContextProvider = 'linear' | 'github' | 'sentry' | 'browser' | 'internal';

/**
 * Type identifiers for context items
 */
export type ContextItemType =
  | 'note'
  | 'linear-issue'
  | 'github-issue'
  | 'github-pr'
  | 'sentry-issue'
  | 'browser-url';

/**
 * Mapping of item types to their providers
 */
export const CONTEXT_ITEM_PROVIDERS: Record<ContextItemType, ContextProvider> = {
  note: 'internal',
  'linear-issue': 'linear',
  'github-issue': 'github',
  'github-pr': 'github',
  'sentry-issue': 'sentry',
  'browser-url': 'browser',
};

/**
 * Base interface for all context items
 */
export interface ContextItemBase {
  /** Unique identifier */
  id: string;
  /** Type of context item */
  type: ContextItemType;
  /** Display title */
  title: string;
  /** Provider for this item */
  provider: ContextProvider;
  /** External URL (for external items) */
  url?: string;
  /** Parent item ID (for nesting under notes) */
  parentNoteId?: string;
  /** When the item was added */
  createdAt: string;
  /** Last updated timestamp */
  updatedAt: string;
}

/**
 * Linear issue context item
 */
export interface LinearIssueContextItem extends ContextItemBase {
  type: 'linear-issue';
  provider: 'linear';
  /** Linear issue identifier (e.g., "ENG-123") */
  identifier: string;
  /** Linear issue ID (optional, used for API calls) */
  linearId?: string;
  /** Team key (e.g., "ENG") */
  teamKey?: string;
  /** Team name */
  teamName?: string;
  /** Issue state */
  state?: string;
  /** Issue priority */
  priority?: number;
}

/**
 * GitHub issue context item
 */
export interface GitHubIssueContextItem extends ContextItemBase {
  type: 'github-issue';
  provider: 'github';
  /** Issue number */
  number: number;
  /** Repository owner/name */
  repo: string;
  /** Issue state */
  state?: 'open' | 'closed';
}

/**
 * Sentry issue context item
 */
export interface SentryIssueContextItem extends ContextItemBase {
  type: 'sentry-issue';
  provider: 'sentry';
  /** Sentry short ID (e.g., "PROJ-123") */
  shortId: string;
  /** Sentry issue ID (optional, used for API calls) */
  sentryId?: string;
  /** Project slug */
  project?: string;
  /** Project name */
  projectName?: string;
  /** Issue level */
  level?: string;
  /** Issue status */
  status?: string;
}

/**
 * Browser URL context item
 */
export interface BrowserUrlContextItem extends ContextItemBase {
  type: 'browser-url';
  provider: 'browser';
  /** Favicon URL if available */
  favicon?: string;
}

/**
 * Note context item (for internal notes)
 */
export interface NoteContextItem extends ContextItemBase {
  type: 'note';
  provider: 'internal';
  /** Note ID */
  noteId: string;
  /** Whether this is the spec note */
  isSpec?: boolean;
  /** Task status if this is a task note */
  taskStatus?: 'not_started' | 'in_progress' | 'complete';
}

/**
 * Union type for all context items
 */
export type ContextItem =
  | LinearIssueContextItem
  | GitHubIssueContextItem
  | SentryIssueContextItem
  | BrowserUrlContextItem
  | NoteContextItem;

/**
 * Configuration for context providers
 */
export interface ContextProviderConfig {
  id: ContextProvider;
  label: string;
  description: string;
  /** Whether the provider requires authentication */
  requiresAuth: boolean;
  /** Icon identifier */
  icon: string;
  /** Item types this provider handles */
  itemTypes: ContextItemType[];
}

/**
 * Provider configurations
 */
export const CONTEXT_PROVIDERS: ContextProviderConfig[] = [
  {
    id: 'internal',
    label: 'Note',
    get description() {
      return m.context_types_addNote_description();
    },
    requiresAuth: false,
    icon: 'note',
    itemTypes: ['note'],
  },
  {
    id: 'linear',
    label: 'Linear',
    get description() {
      return m.context_types_linkLinear_description();
    },
    requiresAuth: true,
    icon: 'linear',
    itemTypes: ['linear-issue'],
  },
  {
    id: 'github',
    label: 'GitHub',
    get description() {
      return m.context_types_linkGithub_description();
    },
    requiresAuth: true,
    icon: 'github',
    itemTypes: ['github-issue'],
  },
  {
    id: 'sentry',
    label: 'Sentry',
    get description() {
      return m.context_types_linkSentry_description();
    },
    requiresAuth: true,
    icon: 'sentry',
    itemTypes: ['sentry-issue'],
  },
  {
    id: 'browser',
    label: 'URL',
    get description() {
      return m.context_types_addBrowserUrl_description();
    },
    requiresAuth: false,
    icon: 'browser',
    itemTypes: ['browser-url'],
  },
];

/**
 * Get provider config by ID
 */
export function getProviderConfig(provider: ContextProvider): ContextProviderConfig | undefined {
  return CONTEXT_PROVIDERS.find((p) => p.id === provider);
}

/**
 * Get provider for an item type
 */
export function getProviderForType(type: ContextItemType): ContextProvider {
  return CONTEXT_ITEM_PROVIDERS[type];
}
