import type {
  Author,
  Note,
  NoteMetadata,
  NoteVersion,
  Reference,
  TaskMetadata,
} from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';

function copyAuthor(author: Author): Author {
  return {
    id: author.id,
    name: author.name,
    type: author.type,
    ...(author.turnNumber !== undefined ? { turnNumber: author.turnNumber } : {}),
  };
}

function copyTask(task: TaskMetadata): TaskMetadata {
  return {
    status: task.status,
    ...(task.assignedAgentIds ? { assignedAgentIds: [...task.assignedAgentIds] } : {}),
    ...(task.acceptanceCriteria ? { acceptanceCriteria: [...task.acceptanceCriteria] } : {}),
    ...(task.estimatedEffort !== undefined ? { estimatedEffort: task.estimatedEffort } : {}),
    ...(task.actualEffort !== undefined ? { actualEffort: task.actualEffort } : {}),
    ...(task.blockedReason !== undefined ? { blockedReason: task.blockedReason } : {}),
    ...(task.completedAt !== undefined ? { completedAt: task.completedAt } : {}),
    ...(task.startedAt !== undefined ? { startedAt: task.startedAt } : {}),
    ...(task.peerOrder !== undefined ? { peerOrder: task.peerOrder } : {}),
    ...(task.dependsOn ? { dependsOn: [...task.dependsOn] } : {}),
    ...(task.conflictsWith ? { conflictsWith: [...task.conflictsWith] } : {}),
    ...(task.unmetDependsOn ? { unmetDependsOn: [...task.unmetDependsOn] } : {}),
  };
}

function copyMetadata(metadata: NoteMetadata): NoteMetadata {
  return {
    ...(metadata.author ? { author: copyAuthor(metadata.author) } : {}),
    ...(metadata.lastAccessedAt !== undefined ? { lastAccessedAt: metadata.lastAccessedAt } : {}),
    ...(metadata.accessCount !== undefined ? { accessCount: metadata.accessCount } : {}),
    ...(metadata.wordCount !== undefined ? { wordCount: metadata.wordCount } : {}),
    ...(metadata.characterCount !== undefined ? { characterCount: metadata.characterCount } : {}),
    ...(metadata.sharedWith ? { sharedWith: [...metadata.sharedWith] } : {}),
    ...(metadata.task ? { task: copyTask(metadata.task) } : {}),
  };
}

function copyReference(reference: Reference): Reference {
  return {
    type: reference.type,
    target: reference.target,
    ...(reference.title !== undefined ? { title: reference.title } : {}),
    ...(reference.description !== undefined ? { description: reference.description } : {}),
  };
}

export function toRuntimeNoteVersion(version: NoteVersion): NoteVersion {
  return {
    versionId: version.versionId,
    versionNumber: version.versionNumber,
    content: version.content,
    title: version.title,
    ...(version.author ? { author: copyAuthor(version.author) } : {}),
    createdAt: version.createdAt,
    ...(version.changeSummary !== undefined ? { changeSummary: version.changeSummary } : {}),
    ...(version.diff !== undefined ? { diff: version.diff } : {}),
  };
}

export function toRuntimeNote(note: Note): Note {
  return {
    id: NoteId(String(note.id)),
    workspaceId: WorkspaceId(String(note.workspaceId)),
    title: note.title,
    content: note.content,
    contentType: note.contentType,
    tags: [...note.tags],
    isPinned: note.isPinned,
    isArchived: note.isArchived,
    ...(note.isDefault !== undefined ? { isDefault: note.isDefault } : {}),
    ...(note.parentId !== undefined ? { parentId: NoteId(String(note.parentId)) } : {}),
    visibility: note.visibility,
    ...(note.metadata ? { metadata: copyMetadata(note.metadata) } : {}),
    ...(note.references ? { references: note.references.map(copyReference) } : {}),
    ...(note.versions ? { versions: note.versions.map(toRuntimeNoteVersion) } : {}),
    ...(note.rev !== undefined ? { rev: note.rev } : {}),
    // Slim-projection markers (§5.2): carried through so content surfaces can
    // detect a row whose full body has not been fetched (isNoteContentStale).
    ...(note.contentPreview !== undefined ? { contentPreview: note.contentPreview } : {}),
    ...(note.contentLength !== undefined ? { contentLength: note.contentLength } : {}),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}
