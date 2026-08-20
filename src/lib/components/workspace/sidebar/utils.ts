import type { Note } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import type { WorkspaceEvent } from '$features/events/types';
import { shouldShowWorkspaceActivityEvent } from '$features/log/utils/activity-event-visibility';
import { getActivityLabel } from '$features/events/activity-labels';
import { isSpecNote } from '$shared/constants/notes';
import { TASK_LINK_REGEX_FLEXIBLE } from '$shared/constants/intent-links';
import { EXCLUDED_STATUSES, IN_PROGRESS_STATUSES, type TaskStats } from '$shared/utils/task-stats';
import {
  faFile,
  faFileCirclePlus,
  faFileCircleXmark,
  faFileEdit,
  faCodeCommit,
  faCodeBranch,
  faTerminal,
} from '@fortawesome/free-solid-svg-icons';
import { faNote } from '$lib/icons/faNote';

// Re-export utilities from centralized location
export { isSpecNote };
export { getNoteIcon } from '$features/notes/utils/note-icon-utils';

/**
 * Get display title for a note
 */
export function getNoteTitle(note: Note): string {
  if (isSpecNote(note.id)) return 'Spec';
  return note.title || m.workspace_links_untitled_label();
}

/**
 * Get the effective parent ID for a note.
 * Uses parentId if set.
 * Spec note is never considered a child.
 */

/**
 * Build a map of child note ID -> parent note ID.
 * Note: Legacy dependency-based parent mapping has been removed.
 * All notes now use parentId directly for hierarchy.
 */

function buildParentMap(_notes: Note[]): Map<string, string> {
  // Return empty map - parentId is now the only source of truth for hierarchy
  return new Map<string, string>();
}

/**
 * Get the effective parent ID for a note, using a pre-built parent map for legacy notes.
 * Uses parentId if set, otherwise looks up in the parent map.
 * Spec note is never considered a child.
 */
function getEffectiveParentIdWithMap(
  note: Note,
  parentMap: Map<string, string>,
): string | undefined {
  // Spec note is never a child
  if (isSpecNote(note.id)) {
    return undefined;
  }

  // Prefer explicit parentId
  if (note.parentId) {
    return note.parentId as string;
  }

  // Fallback: look up in parent map (for legacy notes where parent has dependency to child)
  return parentMap.get(note.id as string);
}

/**
 * Sort notes with spec first, then by custom order or creation date (oldest first, newest at bottom)
 * Child notes (with parentId or dependencies) are kept grouped under their parent.
 * Supports recursive nesting (children, grandchildren, etc.)
 */
export function sortNotes(notes: Note[], customOrder: string[]): Note[] {
  // Defensive check: ensure notes is an array
  if (!Array.isArray(notes)) return [];

  // Build parent map from dependencies (for legacy notes)
  const parentMap = buildParentMap(notes);

  // Build a map of parentId -> children
  const childrenByParent = new Map<string, Note[]>();
  for (const note of notes) {
    const parentId = getEffectiveParentIdWithMap(note, parentMap);
    if (parentId) {
      let children = childrenByParent.get(parentId);
      if (!children) {
        children = [];
        childrenByParent.set(parentId, children);
      }
      children.push(note);
    }
  }

  // Sort children within each parent by createdAt
  for (const children of childrenByParent.values()) {
    children.sort((a, b) => {
      const dateA = new Date(a.createdAt || a.created_at || 0).getTime();
      const dateB = new Date(b.createdAt || b.created_at || 0).getTime();
      return dateA - dateB;
    });
  }

  // Track which notes have been added to the result
  const addedNoteIds = new Set<string>();

  // Recursive function to add a note and all its descendants
  const addNoteWithChildren = (note: Note, result: Note[]): void => {
    result.push(note);
    addedNoteIds.add(note.id as string);
    const children = childrenByParent.get(note.id as string);
    if (children) {
      for (const child of children) {
        addNoteWithChildren(child, result);
      }
    }
  };

  // Get top-level notes (notes without a parent)
  const topLevelNotes = notes.filter((n) => !getEffectiveParentIdWithMap(n, parentMap));

  // Sort top-level notes
  const sortedTopLevel = [...topLevelNotes].sort((a, b) => {
    // Spec always first
    if (isSpecNote(a.id)) return -1;
    if (isSpecNote(b.id)) return 1;

    // Use custom order if available
    if (customOrder.length > 0) {
      const aIndex = customOrder.indexOf(a.id as string);
      const bIndex = customOrder.indexOf(b.id as string);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
    }

    // Fallback: by createdAt ascending (oldest first, newest at bottom)
    const dateA = new Date(a.createdAt || a.created_at || 0).getTime();
    const dateB = new Date(b.createdAt || b.created_at || 0).getTime();
    return dateA - dateB;
  });

  // Build result by recursively adding each top-level note and its descendants
  const result: Note[] = [];
  for (const note of sortedTopLevel) {
    addNoteWithChildren(note, result);
  }

  // Add orphan notes (notes with parentId pointing to non-existent parent) at the end
  for (const note of notes) {
    if (!addedNoteIds.has(note.id as string)) {
      addNoteWithChildren(note, result);
    }
  }

  return result;
}

// Store the last computed parent map for use by isChildNote
// This is a simple cache that gets updated each time sortNotes is called
let lastParentMap: Map<string, string> = new Map();
let lastNoteIds: Set<string> = new Set();

/**
 * Check if a note is a child note (has parentId or is listed as a dependency of another note).
 * Used by NotesPanel to determine indentation.
 *
 * Note: This uses a cached parent map that is updated when sortNotes is called.
 * For accurate results, call sortNotes before using isChildNote.
 */
export function isChildNote(note: Note, allNotes?: Note[]): boolean {
  // If allNotes is provided, rebuild the parent map
  if (allNotes) {
    const noteIds = new Set(allNotes.map((n) => n.id as string));
    // Only rebuild if the notes have changed
    if (noteIds.size !== lastNoteIds.size || ![...noteIds].every((id) => lastNoteIds.has(id))) {
      lastParentMap = buildParentMap(allNotes);
      lastNoteIds = noteIds;
    }
  }

  return !!getEffectiveParentIdWithMap(note, lastParentMap);
}

/**
 * Get the depth (nesting level) of a note in the hierarchy.
 * Root notes have depth 0, direct children have depth 1, etc.
 * Supports recursively nested notes.
 */
export function getNoteDepth(note: Note, allNotes: Note[]): number {
  // Build or update parent map
  const noteIds = new Set(allNotes.map((n) => n.id as string));
  if (noteIds.size !== lastNoteIds.size || ![...noteIds].every((id) => lastNoteIds.has(id))) {
    lastParentMap = buildParentMap(allNotes);
    lastNoteIds = noteIds;
  }

  // Build note map for quick lookups
  const noteMap = new Map(allNotes.map((n) => [n.id as string, n]));

  let depth = 0;
  let currentNote: Note | undefined = note;
  const visited = new Set<string>(); // Prevent infinite loops from circular references

  while (currentNote) {
    const parentId = getEffectiveParentIdWithMap(currentNote, lastParentMap);
    if (!parentId || visited.has(parentId)) break;

    visited.add(currentNote.id as string);
    currentNote = noteMap.get(parentId);
    if (currentNote) depth++;
  }

  return depth;
}

/**
 * Check if any ancestor of a note is collapsed.
 * Used to determine if a note should be hidden in the UI.
 * Supports recursively nested notes.
 */
export function isHiddenByAnyCollapsedAncestor(
  note: Note,
  allNotes: Note[],
  collapsedNoteIds: Set<string>,
): boolean {
  // Build or update parent map
  const noteIds = new Set(allNotes.map((n) => n.id as string));
  if (noteIds.size !== lastNoteIds.size || ![...noteIds].every((id) => lastNoteIds.has(id))) {
    lastParentMap = buildParentMap(allNotes);
    lastNoteIds = noteIds;
  }

  // Build note map for quick lookups
  const noteMap = new Map(allNotes.map((n) => [n.id as string, n]));

  let currentNote: Note | undefined = note;
  const visited = new Set<string>(); // Prevent infinite loops from circular references

  while (currentNote) {
    const parentId = getEffectiveParentIdWithMap(currentNote, lastParentMap);
    if (!parentId || visited.has(parentId)) break;

    // If the parent is collapsed, this note is hidden
    if (collapsedNoteIds.has(parentId)) {
      return true;
    }

    visited.add(currentNote.id as string);
    currentNote = noteMap.get(parentId);
  }

  return false;
}

/**
 * Get children of a note (notes that have this note as parent via parentId or dependencies).
 * Used by NotesPanel for collapse/expand functionality.
 */
export function getChildNotes(parentNote: Note, allNotes: Note[]): Note[] {
  const parentId = parentNote.id as string;
  const parentMap = buildParentMap(allNotes);

  return allNotes.filter((note) => {
    // Check explicit parentId
    if (note.parentId === parentId) return true;
    // Check legacy dependency relationship
    if (parentMap.get(note.id as string) === parentId) return true;
    return false;
  });
}

// ============================================================================
// Task stats utilities
// ============================================================================

// Re-export TaskStats from the canonical shared utility
export type { TaskStats } from '$shared/utils/task-stats';

/**
 * Parse task statistics from note content (linked Task Notes).
 * Counts linked tasks and uses the linked note's task status for completion tracking.
 *
 * Status classification uses the shared constants from `$shared/utils/task-stats`
 * to stay consistent with all other progress indicators in the app.
 */
export function parseTaskStats(content: string | undefined, notes?: Note[]): TaskStats {
  if (!content) return { completed: 0, total: 0, inProgress: 0 };

  // Build a map for quick note lookups
  const noteMap = new Map(notes?.map((n) => [n.id, n]) ?? []);

  let total = 0;
  let completed = 0;
  let inProgress = 0;

  // Find all linked tasks in the content using shared regex pattern
  const taskLinkRegex = new RegExp(TASK_LINK_REGEX_FLEXIBLE.source, 'g');
  const matches = content.matchAll(taskLinkRegex);

  for (const match of matches) {
    const noteId = match[2] as Note['id'];
    const linkedNote = noteMap.get(noteId);
    const taskStatus = linkedNote?.metadata?.task?.status;

    // Skip cancelled tasks — they don't count toward progress
    if (taskStatus && EXCLUDED_STATUSES.has(taskStatus)) continue;

    total++;

    if (taskStatus === 'complete') {
      completed++;
    } else if (taskStatus && IN_PROGRESS_STATUSES.has(taskStatus)) {
      inProgress++;
    }
  }

  return { completed, inProgress, total };
}

// ============================================================================
// Activity utilities
// ============================================================================

const MESSAGE_ACTIVITY_TYPES = new Set([
  'agent:message',
  'agent:message:sent',
  'agent:message:received',
]);

function getActivityMessagePreview(event: WorkspaceEvent): string | null {
  if (!MESSAGE_ACTIVITY_TYPES.has(event.type)) return null;
  const data = event.data as Record<string, unknown> | undefined;
  const raw = data?.content ?? data?.message ?? data?.text;
  if (typeof raw !== 'string') return null;
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > 60 ? `${normalized.slice(0, 59).trimEnd()}…` : normalized;
}

export function shouldShowActivityPreviewEvent(event: WorkspaceEvent): boolean {
  if (!shouldShowWorkspaceActivityEvent(event)) return false;
  const data = event.data as Record<string, unknown> | undefined;
  if (event.type === 'agent:status-changed' && (data?.status ?? data?.newStatus) === 'active') {
    return false;
  }
  return !MESSAGE_ACTIVITY_TYPES.has(event.type) || getActivityMessagePreview(event) !== null;
}

function getScriptActivityTitle(
  event: WorkspaceEvent,
  scriptNames: Readonly<Record<string, string>>,
): string {
  const data = event.data as Record<string, unknown> | undefined;
  const scriptId = typeof data?.scriptId === 'string' ? data.scriptId : undefined;
  const name = (scriptId && scriptNames[scriptId]) || 'Script';
  const status = data?.status;

  if (status === 'running') return `${name} started`;
  if (status === 'exited') {
    const exitCode = data?.exitCode;
    if (typeof exitCode === 'number' && exitCode !== 0) {
      return `${name} failed (exit ${exitCode})`;
    }
    if (data?.error) return `${name} failed`;
    return `${name} stopped`;
  }
  return status ? `${name} is ${String(status)}` : `${name} state changed`;
}

/**
 * Get the display title for an activity event
 */
export function getActivityTitle(
  event: WorkspaceEvent,
  scriptNames: Readonly<Record<string, string>> = {},
  agentNames: Readonly<Record<string, string>> = {},
): string {
  const data = event.data as Record<string, unknown> | undefined;
  const agentStatus = data?.status ?? data?.newStatus;
  if (
    event.type === 'agent:idle' ||
    event.type === 'agent:completed' ||
    (event.type === 'agent:status-changed' &&
      (agentStatus === 'idle' || agentStatus === 'completed' || agentStatus === 'done'))
  ) {
    const actorName =
      event.actor?.type === 'agent' || event.actor?.type === 'external'
        ? event.actor.name
        : undefined;
    const agentId = getEventAgentId(event);
    const subjectName = [
      data?.agentName,
      data?.name,
      agentId && agentNames[agentId],
      actorName,
    ].find((name): name is string => typeof name === 'string' && name.trim().length > 0);
    return subjectName
      ? m.events_activity_nameFinished_label({ name: subjectName.trim() })
      : m.events_activity_partFinished_label().trim();
  }
  const messagePreview = getActivityMessagePreview(event);
  if (messagePreview) {
    const actorName = event.actor?.type === 'agent' ? event.actor.name : undefined;
    const sender = data?.fromAgentName || data?.agentName || actorName || 'Agent';
    return `${sender}: ${messagePreview}`.replaceAll('`', '');
  }
  if (event.type === 'script:state') {
    return getScriptActivityTitle(event, scriptNames);
  }
  return getActivityLabel(event).replaceAll('`', '');
}

/**
 * Resolve the agent an activity event is about, for avatar rendering and
 * click-through. Prefers an agent/external actor; for `agent:*` lifecycle
 * events (created/completed/…) the actor is often the system, so fall back to
 * the subject agent carried in the payload.
 */
export function getEventAgentId(event: WorkspaceEvent): string | null {
  const actor = event.actor;
  if ((actor?.type === 'agent' || actor?.type === 'external') && actor.id) {
    return actor.id;
  }
  if (event.type.startsWith('agent:')) {
    const data = event.data as Record<string, unknown> | undefined;
    const subject = (data?.agentId || event.sessionId || null) as string | null;
    return subject;
  }
  return null;
}

export interface ActivityChatTarget {
  messageId?: string;
  toolCallId?: string;
  turnNumber?: number;
}

/** Resolve the most precise chat location carried by an activity event. */
export function getActivityChatTarget(event: WorkspaceEvent): ActivityChatTarget {
  const data = event.data as Record<string, unknown> | undefined;
  const messageId =
    event.relatedChatMessageId ||
    (typeof data?.messageId === 'string' ? data.messageId : undefined) ||
    event.provenance?.chat?.messageId;
  const toolCallId =
    event.relatedToolCallId ||
    (typeof data?.toolCallId === 'string' ? data.toolCallId : undefined) ||
    event.provenance?.execution?.toolCallId;
  const dataTurnNumber = data?.turnNumber;
  const turnNumber =
    typeof dataTurnNumber === 'number' ? dataTurnNumber : event.provenance?.chat?.turnNumber;

  return { messageId, toolCallId, turnNumber };
}

/**
 * Get the appropriate icon for an activity event
 */
export function getActivityIcon(event: WorkspaceEvent) {
  const type = event.type;
  const data = event.data as any;

  if (type === 'file:changed') {
    if (data?.action === 'create') return faFileCirclePlus;
    if (data?.action === 'delete') return faFileCircleXmark;
    return faFileEdit;
  }

  const iconMap: Record<string, any> = {
    'file:created': faFileCirclePlus,
    'file:deleted': faFileCircleXmark,
    'git:commit': faCodeCommit,
    'git:branch': faCodeBranch,
    'note:created': faNote,
    'note:updated': faNote,
    'terminal:command': faTerminal,
    'script:state': faTerminal,
  };

  return iconMap[type] || faFile;
}
