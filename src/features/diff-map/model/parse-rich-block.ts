import { ChangeStage, type TrackedChange } from '$features/file-tracking/types';
import { buildDiffMapDocument } from './build-document';
import type {
  DiffMapAnnotation,
  DiffMapDocument,
  DiffMapFile,
  DiffMapFileStatus,
  DiffMapGroup,
  DiffMapSection,
  DiffMapSource,
} from './types';

const statuses = new Set<DiffMapFileStatus>([
  'added',
  'modified',
  'deleted',
  'renamed',
  'binary',
  'mode',
]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validSource(value: unknown): value is DiffMapSource {
  if (!record(value) || typeof value.kind !== 'string' || typeof value.snapshotId !== 'string') {
    return false;
  }
  return ['working-tree', 'commit', 'range', 'pr', 'chat-turn'].includes(value.kind);
}

function validFile(value: unknown): value is DiffMapFile {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    typeof value.path === 'string' &&
    typeof value.name === 'string' &&
    typeof value.dir === 'string' &&
    statuses.has(value.status as DiffMapFileStatus) &&
    typeof value.additions === 'number' &&
    typeof value.deletions === 'number' &&
    typeof value.statsKnown === 'boolean'
  );
}

function validGroup(value: unknown): value is DiffMapGroup {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    typeof value.path === 'string' &&
    typeof value.displayPrefix === 'string' &&
    typeof value.displayName === 'string' &&
    Array.isArray(value.fileIds) &&
    value.fileIds.every((id) => typeof id === 'string') &&
    typeof value.changedCount === 'number'
  );
}

function validSection(value: unknown, groupIds: ReadonlySet<string>): value is DiffMapSection {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    typeof value.path === 'string' &&
    typeof value.displayPrefix === 'string' &&
    typeof value.displayName === 'string' &&
    Array.isArray(value.groupIds) &&
    value.groupIds.every((id) => typeof id === 'string' && groupIds.has(id)) &&
    typeof value.changedCount === 'number' &&
    (value.totalCount === undefined || typeof value.totalCount === 'number')
  );
}

function annotations(value: unknown): DiffMapAnnotation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate, index) => {
    if (!record(candidate) || typeof candidate.kind !== 'string') return [];
    const id = typeof candidate.id === 'string' ? candidate.id : `${candidate.kind}:${index}`;
    if (candidate.kind === 'claim') {
      if (
        typeof candidate.label !== 'string' ||
        !Array.isArray(candidate.paths) ||
        !candidate.paths.every((path) => typeof path === 'string') ||
        (!record(candidate.provenance) && typeof candidate.provenance !== 'string')
      ) {
        return [];
      }
      return [{ ...candidate, id } as DiffMapAnnotation];
    }
    if (candidate.kind === 'group') {
      if (
        typeof candidate.label !== 'string' ||
        !Array.isArray(candidate.paths) ||
        !candidate.paths.every((path) => typeof path === 'string')
      ) {
        return [];
      }
      return [{ ...candidate, id } as DiffMapAnnotation];
    }
    return [{ ...candidate, id } as DiffMapAnnotation];
  });
}

function fullDocument(value: Record<string, unknown>): DiffMapDocument | null {
  if (
    !validSource(value.source) ||
    !Array.isArray(value.files) ||
    !value.files.every(validFile) ||
    !Array.isArray(value.groups) ||
    !value.groups.every(validGroup)
  ) {
    return null;
  }
  const groupIds = new Set((value.groups as DiffMapGroup[]).map((group) => group.id));
  if (
    value.sections !== undefined &&
    (!Array.isArray(value.sections) ||
      !value.sections.every((section) => validSection(section, groupIds)))
  ) {
    return null;
  }
  return { ...(value as unknown as DiffMapDocument), annotations: annotations(value.annotations) };
}

function compactDocument(value: Record<string, unknown>): DiffMapDocument | null {
  if (!Array.isArray(value.files)) return null;
  const compact = value.files;
  if (
    !compact.every(
      (file) =>
        record(file) &&
        typeof file.path === 'string' &&
        typeof file.additions === 'number' &&
        typeof file.deletions === 'number' &&
        statuses.has(file.status as DiffMapFileStatus),
    )
  ) {
    return null;
  }
  const changes = compact.map((entry) => {
    const file = entry as Record<string, unknown>;
    return {
      id: file.path,
      file: file.path,
      relativePath: file.path,
      stage: ChangeStage.Unstaged,
      status: ['added', 'modified', 'deleted', 'renamed'].includes(file.status as string)
        ? file.status
        : 'modified',
      stats: { additions: file.additions, deletions: file.deletions },
      attribution: { timestamp: 0 },
    } as TrackedChange;
  });
  const snapshotId = compact.map((file) => (file as Record<string, unknown>).path).join('|');
  const document = buildDiffMapDocument(changes, {
    source: { kind: 'chat-turn', sessionId: 'rich-block', turnId: 'rich-block', snapshotId },
  });
  document.files = document.files.map((file) => ({
    ...file,
    status: (
      compact.find((entry) => record(entry) && entry.path === file.path) as Record<string, unknown>
    ).status as DiffMapFileStatus,
  }));
  document.annotations = annotations(value.annotations);
  return document;
}

export function parseDiffMapDocument(value: unknown): DiffMapDocument | null {
  if (!record(value)) return null;
  return 'source' in value || 'groups' in value ? fullDocument(value) : compactDocument(value);
}
