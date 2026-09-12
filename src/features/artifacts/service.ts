import { appClient } from '$lib/client';
import type { NotesClient } from '$lib/client/app-client';
import type { ContextItem } from '$lib/components/chat/input/context-api';
import { WorkspaceId } from '$shared/types/branded-ids';
import type {
  ArtifactDocument,
  ArtifactSelection,
  ArtifactSelectionSnapshot,
} from '$shared/types/visual-artifact';
import { createSelectionSnapshot, findArtifactDocument, serializeArtifactBlock } from './model';

export interface LoadedArtifact {
  document: ArtifactDocument;
  revision: number;
  rawBlock: string;
}

export class ArtifactConflictError extends Error {
  constructor() {
    super('The shared artifact changed. Reload before saving.');
    this.name = 'ArtifactConflictError';
  }
}

/** Notes own identity, persistence, subscriptions, conditional writes, and history. */
export function createArtifactService(notes: Pick<NotesClient, 'get' | 'create' | 'edit'>) {
  async function loadArtifact(
    workspaceId: string,
    noteId: string,
    artifactId: string,
  ): Promise<LoadedArtifact> {
    const note = await notes.get(noteId, workspaceId);
    if (!note || note.workspaceId !== workspaceId) throw new Error('Shared artifact not found');
    const parsed = findArtifactDocument(note.content, artifactId);
    if (!parsed || typeof note.rev !== 'number' || !Number.isInteger(note.rev) || note.rev < 0)
      throw new Error('Shared artifact is invalid or has no revision');
    return { ...parsed, revision: note.rev };
  }
  async function saveArtifact(
    workspaceId: string,
    noteId: string,
    loaded: LoadedArtifact,
    next: ArtifactDocument,
  ): Promise<LoadedArtifact> {
    if (next.id !== loaded.document.id) throw new Error('Artifact identity cannot change');
    const replacement = serializeArtifactBlock({ document: next });
    // expectedVersion is checked atomically by the daemon. Exact source preserves other note content.
    const result = await notes.edit(
      noteId,
      loaded.rawBlock,
      replacement,
      loaded.revision,
      workspaceId,
    );
    if (result.conflict) throw new ArtifactConflictError();
    if (!result.success) throw new Error(result.error || 'Could not save shared artifact');
    // A successful conditional write bumps rev once. Do not refetch here: that could
    // adopt a different writer's later document as the baseline for our local draft.
    return {
      document: JSON.parse(JSON.stringify(next)) as ArtifactDocument,
      rawBlock: replacement,
      revision: result.noteRev ?? loaded.revision + 1,
    };
  }
  async function createArtifact(
    workspaceId: string,
    document: ArtifactDocument,
  ): Promise<{ noteId: string; artifactId: string }> {
    const result = await notes.create({
      workspaceId: WorkspaceId(workspaceId),
      title: document.title,
      content: serializeArtifactBlock({ document }),
      tags: ['artifact'],
    });
    if (!result.success || !result.id)
      throw new Error(result.error || 'Could not create shared artifact');
    return { noteId: result.id, artifactId: document.id };
  }
  return { loadArtifact, saveArtifact, createArtifact };
}

export const { loadArtifact, saveArtifact, createArtifact } = createArtifactService(
  appClient.notes,
);

export function artifactSelectionToContextItem(
  document: ArtifactDocument,
  selection: ArtifactSelection,
  source: ArtifactSelectionSnapshot['source'],
  comment = '',
): ContextItem {
  const snapshot = createSelectionSnapshot(document, selection, source, comment);
  const semanticId =
    'artifact:' +
    (source.noteId ? encodeURIComponent(source.noteId) + '/' : '') +
    encodeURIComponent(source.artifactId) +
    (selection.region
      ? '#rect:' +
        [
          selection.region.x,
          selection.region.y,
          selection.region.width,
          selection.region.height,
        ].join(',')
      : selection.itemIds.length
        ? '#items:' + selection.itemIds.map(encodeURIComponent).join(',')
        : '');
  const projection = {
    ...snapshot,
    items: snapshot.items.map((item) => ({
      ...item,
      ...(item.src ? { src: compactImageSource(item.src) } : {}),
    })),
    ...(snapshot.image
      ? { image: { ...snapshot.image, src: compactImageSource(snapshot.image.src) } }
      : {}),
  };
  return {
    id: crypto.randomUUID(),
    type: 'selection',
    label: document.title,
    description: comment || undefined,
    content:
      '[Visual artifact selection ' + semanticId + ']\n' + JSON.stringify(projection, null, 2),
    metadata: { semanticId, artifactSelection: snapshot },
  };
}

function compactImageSource(src: string): string {
  return src.startsWith('data:') ? '[attached ' + src.slice(5, src.indexOf(';')) + ' image]' : src;
}
