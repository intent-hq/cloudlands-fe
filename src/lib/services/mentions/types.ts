/**
 * Enhanced Mention System Types
 */

export interface MentionCandidate {
  id: string;
  type: MentionType;
  label: string;
  subtitle?: string;
  description?: string;
  icon?: string;
  uri: string;
  group?: string;
  score?: number;
  meta?: MentionMeta;
}

export interface MentionMeta {
  path?: string;
  fullPath?: string;
  fullUrl?: string;
  isExternalLink?: boolean;
  workspaceId?: string;
  range?: MentionRange;
  rev?: string;
  branch?: string;
  status?: 'ok' | 'warning' | 'error';
  preview?: string;
  lastModified?: Date;
  size?: number;
  language?: string;
  fileCount?: number;
  url?: string;
  guidelines?: boolean;
  taskStatus?: 'not_started' | 'in_progress' | 'completed' | 'cancelled';
  author?: string;
  assignee?: string;
  promptToken?: string;
}

export interface MentionRange {
  start: number;
  end: number;
  startCol?: number;
  endCol?: number;
}

export type MentionType =
  | 'file'
  | 'file-range'
  | 'folder'
  | 'source-folder'
  | 'note'
  | 'note-range'
  | 'external-source'
  | 'rule'
  | 'task'
  | 'user-guidelines'
  | 'agent-memories'
  | 'personality'
  | 'workspace'
  | 'agent'
  | 'specialist'
  | 'symbol'
  | 'branch'
  | 'commit'
  | 'pr'
  | 'linear-issue'
  | 'github-issue'
  | 'command'
  | 'group'
  | 'script'
  | 'terminal';

export interface SearchContext {
  workspaceId?: string;
  repoPath?: string;
  currentFile?: string;
  currentNote?: string;
  imports?: string[];
  recentFiles?: string[];
  signal?: AbortSignal;
}

export interface MentionGroup {
  id: string;
  label: string;
  icon?: string;
  items?: MentionCandidate[];
  subgroups?: MentionGroup[];
}

export interface BreadcrumbItem {
  id: string;
  label: string;
  icon?: string;
}

export interface PreviewContent {
  title: string;
  icon?: string;
  fullPath?: string;
  branch?: string;
  rev?: string;
  range?: MentionRange;
  snippet?: string;
  description?: string;
  status?: string;
  actions?: PreviewAction[];
  error?: string;
  /** Workspace title for cross-workspace links */
  workspaceTitle?: string;
}

export interface PreviewAction {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  handler?: () => void | Promise<void>;
}

export interface ResolveResult {
  exists: boolean;
  type: MentionType;
  label: string;
  meta?: MentionMeta;
  preview?: PreviewContent;
  error?: string;
}

export interface EnhancedResolveResult extends ResolveResult {
  relatedItems?: MentionCandidate[];
  diff?: string;
  blame?: BlameInfo[];
}

export interface BlameInfo {
  line: number;
  author: string;
  date: Date;
  commit: string;
  message: string;
}

export interface Provider {
  id: string;
  triggers?: string[];
  default?: boolean;

  search(query: string, context: SearchContext): Promise<MentionCandidate[]>;

  // Optional enhanced capabilities
  supportsRanges?: boolean;
  supportsLivePreview?: boolean;
  supportsQuickEdit?: boolean;
  supportsSemantic?: boolean;

  scoreRelevance?(item: MentionCandidate, context: SearchContext): number;
  getGroups?(): MentionGroup[];
  getCategoryForItem?(item: MentionCandidate): string;
}

export interface Resolver {
  canResolve(uri: string): boolean;
  resolve(uri: string): Promise<ResolveResult>;

  // Optional enhanced resolution
  resolveWithContext?(uri: string, context: ResolutionContext): Promise<EnhancedResolveResult>;
  getLivePreview?(uri: string): Observable<PreviewContent>;
  getRelatedItems?(uri: string): Promise<MentionCandidate[]>;
  getDiff?(uri: string, since: Date): Promise<string>;
}

export interface ResolutionContext {
  workspaceId: string;
  includeRelated?: boolean;
  includeDiff?: boolean;
  includeBlame?: boolean;
}

export interface CachedResult {
  results: MentionCandidate[];
  timestamp: number;
}

export interface MentionSystemConfig {
  debounceMs?: number;
  maxResults?: number;
  cacheMaxAge?: number;
  enableSemantic?: boolean;
  enableLivePreview?: boolean;
  enableCollaboration?: boolean;
}

// Special mention items
export const SPECIAL_MENTIONS = {
  USE_DEFAULT_CONTEXT: {
    id: 'use-default-context',
    type: 'command' as MentionType,
    label: 'Use Default Context',
    description: 'Include default space context',
    icon: '🔄',
    uri: 'devspace://command/use-default-context',
  },
  CLEAR_CONTEXT: {
    id: 'clear-context',
    type: 'command' as MentionType,
    label: 'Clear Context',
    description: 'Remove all context mentions',
    icon: '🗑️',
    uri: 'devspace://command/clear-context',
  },
  USER_GUIDELINES: {
    id: 'user-guidelines',
    type: 'user-guidelines' as MentionType,
    label: 'User Guidelines',
    description: 'Include user-defined guidelines',
    icon: '📋',
    uri: 'devspace://user-guidelines/main',
  },
  AGENT_MEMORIES: {
    id: 'agent-memories',
    type: 'agent-memories' as MentionType,
    label: 'Agent Memories',
    description: 'Include AI agent memories',
    icon: '🧠',
    uri: 'devspace://agent-memories/current',
  },
};

// Type guards
export function isMentionGroup(item: MentionCandidate | MentionGroup): item is MentionGroup {
  return 'items' in item || 'subgroups' in item;
}

export function hasRange(type: MentionType): boolean {
  return type === 'file-range' || type === 'note-range';
}

export function isSpecialCommand(type: MentionType): boolean {
  return type === 'command';
}

export function isFileRangeType(type: MentionType): boolean {
  return type === 'file-range';
}

export function isCommandType(type: MentionType): boolean {
  return type === 'command';
}

// Validation functions
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a mention candidate object
 * @param candidate - The candidate to validate
 * @returns true if valid, false otherwise
 */
export function isValidMentionCandidate(candidate: unknown): candidate is MentionCandidate {
  // Check if it's an object
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }

  const obj = candidate as Record<string, unknown>;

  // Check required fields
  if (typeof obj.id !== 'string') return false;
  if (typeof obj.label !== 'string') return false;
  if (typeof obj.uri !== 'string') return false;
  if (typeof obj.type !== 'string') return false;

  // Check optional fields if present
  if (obj.subtitle !== undefined && typeof obj.subtitle !== 'string') return false;
  if (obj.description !== undefined && typeof obj.description !== 'string') return false;
  if (obj.icon !== undefined && typeof obj.icon !== 'string') return false;
  if (obj.score !== undefined && typeof obj.score !== 'number') return false;
  if (obj.group !== undefined && typeof obj.group !== 'string') return false;

  return true;
}

/**
 * Validates mention data and returns detailed error information
 * @param data - The data to validate
 * @returns ValidationResult with valid flag and optional error message
 */
export function validateMentionData(data: unknown): ValidationResult {
  // Check if it's an object
  if (!data || typeof data !== 'object') {
    return {
      valid: false,
      error: 'Mention data must be an object',
    };
  }

  const obj = data as Record<string, unknown>;

  // Check required fields
  if (!obj.id) {
    return {
      valid: false,
      error: 'Missing required field: id',
    };
  }

  if (!obj.type) {
    return {
      valid: false,
      error: 'Missing required field: type',
    };
  }

  if (!obj.label) {
    return {
      valid: false,
      error: 'Missing required field: label',
    };
  }

  if (!obj.uri) {
    return {
      valid: false,
      error: 'Missing required field: uri',
    };
  }

  return {
    valid: true,
  };
}

// Observable type for live updates
export interface Observable<T> {
  subscribe(observer: (value: T) => void): () => void;
}
