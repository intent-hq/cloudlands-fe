import { buildDiffMapDocument } from './build-document';
import type {
  DiffMapAnnotation,
  DiffMapAttribution,
  DiffMapDocument,
  DiffMapExternalFileFacts,
  DiffMapFile,
  DiffMapFileStatus,
  DiffMapGroup,
  DiffMapHunk,
  DiffMapSection,
  DiffMapSource,
} from './types';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function status(value: unknown): DiffMapFileStatus | null {
  switch (value) {
    case 'added':
    case 'modified':
    case 'deleted':
    case 'renamed':
    case 'binary':
    case 'mode':
      return value;
    default:
      return null;
  }
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function count(value: unknown): value is number {
  return finiteNumber(value) && Number.isInteger(value) && value >= 0;
}

function source(value: unknown): DiffMapSource | null {
  if (!record(value) || typeof value.kind !== 'string' || typeof value.snapshotId !== 'string') {
    return null;
  }
  switch (value.kind) {
    case 'working-tree':
      return typeof value.workspaceId === 'string'
        ? { kind: value.kind, workspaceId: value.workspaceId, snapshotId: value.snapshotId }
        : null;
    case 'commit':
      return typeof value.commitHash === 'string'
        ? { kind: value.kind, commitHash: value.commitHash, snapshotId: value.snapshotId }
        : null;
    case 'range':
      return typeof value.base === 'string' && typeof value.head === 'string'
        ? { kind: value.kind, base: value.base, head: value.head, snapshotId: value.snapshotId }
        : null;
    case 'pr':
      return typeof value.repository === 'string' && count(value.prNumber)
        ? {
            kind: value.kind,
            repository: value.repository,
            prNumber: value.prNumber,
            snapshotId: value.snapshotId,
          }
        : null;
    case 'chat-turn':
      return typeof value.sessionId === 'string' && typeof value.turnId === 'string'
        ? {
            kind: value.kind,
            sessionId: value.sessionId,
            turnId: value.turnId,
            snapshotId: value.snapshotId,
          }
        : null;
    default:
      return null;
  }
}

function lineRange(value: unknown): { start: number; end: number } | null {
  if (!record(value) || !count(value.start) || !count(value.end) || value.end < value.start) {
    return null;
  }
  return { start: value.start, end: value.end };
}

function track(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length % 2 !== 0) return null;
  if (!value.every((entry) => finiteNumber(entry) && entry >= 0 && entry <= 1)) return null;
  return [...value];
}

function hunks(value: unknown): DiffMapHunk[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: DiffMapHunk[] = [];
  for (const candidate of value) {
    if (!record(candidate)) return null;
    const oldRange = candidate.oldRange === undefined ? undefined : lineRange(candidate.oldRange);
    const newRange = candidate.newRange === undefined ? undefined : lineRange(candidate.newRange);
    if (oldRange === null || newRange === null || (!oldRange && !newRange)) return null;
    parsed.push({ ...(oldRange ? { oldRange } : {}), ...(newRange ? { newRange } : {}) });
  }
  return parsed;
}

function attribution(value: unknown): DiffMapAttribution | null {
  if (!record(value) || !finiteNumber(value.timestamp)) return null;
  if (value.manual !== undefined && typeof value.manual !== 'boolean') return null;
  let agent: DiffMapAttribution['agent'];
  if (value.agent !== undefined) {
    if (
      !record(value.agent) ||
      typeof value.agent.agentId !== 'string' ||
      typeof value.agent.agentName !== 'string' ||
      typeof value.agent.sessionId !== 'string' ||
      !count(value.agent.turnNumber) ||
      !finiteNumber(value.agent.timestamp) ||
      (value.agent.messageId !== undefined && typeof value.agent.messageId !== 'string') ||
      (value.agent.toolCallId !== undefined && typeof value.agent.toolCallId !== 'string')
    ) {
      return null;
    }
    agent = {
      agentId: value.agent.agentId,
      agentName: value.agent.agentName,
      sessionId: value.agent.sessionId,
      turnNumber: value.agent.turnNumber,
      timestamp: value.agent.timestamp,
      ...(typeof value.agent.messageId === 'string' ? { messageId: value.agent.messageId } : {}),
      ...(typeof value.agent.toolCallId === 'string' ? { toolCallId: value.agent.toolCallId } : {}),
    };
  }
  return {
    timestamp: value.timestamp,
    ...(typeof value.manual === 'boolean' ? { manual: value.manual } : {}),
    ...(agent ? { agent } : {}),
  };
}

function file(value: unknown): DiffMapFile | null {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    typeof value.path !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.dir !== 'string' ||
    !finiteNumber(value.additions) ||
    !finiteNumber(value.deletions) ||
    typeof value.statsKnown !== 'boolean'
  ) {
    return null;
  }
  const parsedStatus = status(value.status);
  if (!parsedStatus) return null;
  const oldTrack = value.oldTrack === undefined ? undefined : track(value.oldTrack);
  const newTrack = value.newTrack === undefined ? undefined : track(value.newTrack);
  const parsedHunks = value.hunks === undefined ? undefined : hunks(value.hunks);
  const parsedAttribution =
    value.attribution === undefined ? undefined : attribution(value.attribution);
  if (
    oldTrack === null ||
    newTrack === null ||
    parsedHunks === null ||
    parsedAttribution === null
  ) {
    return null;
  }
  if (value.renamedFrom !== undefined && typeof value.renamedFrom !== 'string') return null;
  if (value.contentHash !== undefined && typeof value.contentHash !== 'string') return null;
  return {
    id: value.id,
    path: value.path,
    name: value.name,
    dir: value.dir,
    status: parsedStatus,
    additions: value.additions,
    deletions: value.deletions,
    statsKnown: value.statsKnown,
    ...(typeof value.renamedFrom === 'string' ? { renamedFrom: value.renamedFrom } : {}),
    ...(oldTrack ? { oldTrack } : {}),
    ...(newTrack ? { newTrack } : {}),
    ...(parsedHunks ? { hunks: parsedHunks } : {}),
    ...(parsedAttribution ? { attribution: parsedAttribution } : {}),
    ...(typeof value.contentHash === 'string' ? { contentHash: value.contentHash } : {}),
  };
}

function group(value: unknown): DiffMapGroup | null {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    typeof value.path !== 'string' ||
    typeof value.displayPrefix !== 'string' ||
    typeof value.displayName !== 'string' ||
    !Array.isArray(value.fileIds) ||
    !value.fileIds.every((id) => typeof id === 'string') ||
    !count(value.changedCount) ||
    (value.totalCount !== undefined && !count(value.totalCount))
  ) {
    return null;
  }
  return {
    id: value.id,
    path: value.path,
    displayPrefix: value.displayPrefix,
    displayName: value.displayName,
    fileIds: [...value.fileIds],
    changedCount: value.changedCount,
    ...(typeof value.totalCount === 'number' ? { totalCount: value.totalCount } : {}),
  };
}

function section(value: unknown, groupIds: ReadonlySet<string>): DiffMapSection | null {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    typeof value.path !== 'string' ||
    typeof value.displayPrefix !== 'string' ||
    typeof value.displayName !== 'string' ||
    !Array.isArray(value.groupIds) ||
    !value.groupIds.every((id) => typeof id === 'string' && groupIds.has(id)) ||
    !count(value.changedCount) ||
    (value.totalCount !== undefined && !count(value.totalCount))
  ) {
    return null;
  }
  return {
    id: value.id,
    path: value.path,
    displayPrefix: value.displayPrefix,
    displayName: value.displayName,
    groupIds: [...value.groupIds],
    changedCount: value.changedCount,
    ...(typeof value.totalCount === 'number' ? { totalCount: value.totalCount } : {}),
  };
}

function factAnnotationKind(
  value: string,
): value is 'attribution' | 'comment' | 'review' | 'changed-since-review' | 'test' | 'custom' {
  return ['attribution', 'comment', 'review', 'changed-since-review', 'test', 'custom'].includes(
    value,
  );
}

function annotations(value: unknown): DiffMapAnnotation[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const parsed: DiffMapAnnotation[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index];
    if (!record(candidate) || typeof candidate.kind !== 'string') return null;
    const id = typeof candidate.id === 'string' ? candidate.id : `${candidate.kind}:${index}`;
    if (candidate.kind === 'claim') {
      if (
        typeof candidate.label !== 'string' ||
        !Array.isArray(candidate.paths) ||
        !candidate.paths.every((path) => typeof path === 'string') ||
        (!record(candidate.provenance) && typeof candidate.provenance !== 'string') ||
        (candidate.hunks !== undefined && !Array.isArray(candidate.hunks))
      ) {
        return null;
      }
      parsed.push({
        id,
        kind: candidate.kind,
        label: candidate.label,
        paths: [...candidate.paths],
        provenance: record(candidate.provenance)
          ? { ...candidate.provenance }
          : candidate.provenance,
        ...(Array.isArray(candidate.hunks) ? { hunks: [...candidate.hunks] } : {}),
      });
      continue;
    }
    if (candidate.kind === 'group') {
      if (
        typeof candidate.label !== 'string' ||
        !Array.isArray(candidate.paths) ||
        !candidate.paths.every((path) => typeof path === 'string')
      ) {
        return null;
      }
      parsed.push({
        id,
        kind: candidate.kind,
        label: candidate.label,
        paths: [...candidate.paths],
      });
      continue;
    }
    if (!factAnnotationKind(candidate.kind)) continue;
    const oldRange = candidate.oldRange === undefined ? undefined : lineRange(candidate.oldRange);
    const newRange = candidate.newRange === undefined ? undefined : lineRange(candidate.newRange);
    if (
      oldRange === null ||
      newRange === null ||
      (candidate.fileId !== undefined && typeof candidate.fileId !== 'string') ||
      (candidate.label !== undefined && typeof candidate.label !== 'string') ||
      (candidate.data !== undefined && !record(candidate.data))
    ) {
      return null;
    }
    parsed.push({
      id,
      kind: candidate.kind,
      ...(typeof candidate.fileId === 'string' ? { fileId: candidate.fileId } : {}),
      ...(oldRange ? { oldRange } : {}),
      ...(newRange ? { newRange } : {}),
      ...(typeof candidate.label === 'string' ? { label: candidate.label } : {}),
      ...(record(candidate.data) ? { data: { ...candidate.data } } : {}),
    });
  }
  return parsed;
}

function annotationsReferenceFiles(
  parsed: readonly DiffMapAnnotation[],
  fileIds: ReadonlySet<string>,
  filePaths: ReadonlySet<string>,
): boolean {
  if (new Set(parsed.map((annotation) => annotation.id)).size !== parsed.length) return false;
  return parsed.every((annotation) => {
    if (annotation.kind === 'claim' || annotation.kind === 'group') {
      return annotation.paths.every((path) => filePaths.has(path));
    }
    return annotation.fileId === undefined || fileIds.has(annotation.fileId);
  });
}

function fullDocument(value: Record<string, unknown>): DiffMapDocument | null {
  if (
    !source(value.source) ||
    !Array.isArray(value.files) ||
    !value.files.every((candidate) => file(candidate) !== null) ||
    !Array.isArray(value.groups) ||
    !value.groups.every((candidate) => group(candidate) !== null)
  ) {
    return null;
  }
  const parsedSource = source(value.source);
  const files = value.files.flatMap((candidate) => {
    const parsed = file(candidate);
    return parsed ? [parsed] : [];
  });
  const groups = value.groups.flatMap((candidate) => {
    const parsed = group(candidate);
    return parsed ? [parsed] : [];
  });
  const fileIds = new Set(files.map((candidate) => candidate.id));
  const groupIds = new Set(groups.map((candidate) => candidate.id));
  if (!parsedSource || fileIds.size !== files.length || groupIds.size !== groups.length)
    return null;
  const membership = new Map<string, number>();
  for (const candidate of groups) {
    const uniqueIds = new Set(candidate.fileIds);
    if (
      uniqueIds.size !== candidate.fileIds.length ||
      candidate.changedCount !== candidate.fileIds.length ||
      candidate.fileIds.some((id) => !fileIds.has(id))
    ) {
      return null;
    }
    for (const id of candidate.fileIds) membership.set(id, (membership.get(id) ?? 0) + 1);
  }
  if (files.some((candidate) => membership.get(candidate.id) !== 1)) return null;
  const parsedAnnotations = annotations(value.annotations);
  const filePaths = new Set(files.map((candidate) => candidate.path));
  if (
    parsedAnnotations === null ||
    !annotationsReferenceFiles(parsedAnnotations, fileIds, filePaths)
  ) {
    return null;
  }
  let sections: DiffMapSection[] | undefined;
  if (value.sections !== undefined) {
    if (!Array.isArray(value.sections)) return null;
    sections = value.sections.flatMap((candidate) => {
      const parsed = section(candidate, groupIds);
      return parsed ? [parsed] : [];
    });
    if (
      sections.length !== value.sections.length ||
      new Set(sections.map((candidate) => candidate.id)).size !== sections.length ||
      sections.some((candidate) => new Set(candidate.groupIds).size !== candidate.groupIds.length)
    ) {
      return null;
    }
  }
  return {
    source: parsedSource,
    files,
    groups,
    ...(sections ? { sections } : {}),
    annotations: parsedAnnotations,
  };
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
        finiteNumber(file.additions) &&
        finiteNumber(file.deletions) &&
        status(file.status) !== null &&
        (file.renamedFrom === undefined || typeof file.renamedFrom === 'string'),
    )
  ) {
    return null;
  }
  const changes: DiffMapExternalFileFacts[] = compact.flatMap((entry) => {
    if (!record(entry) || typeof entry.path !== 'string') return [];
    const parsedStatus = status(entry.status);
    if (!parsedStatus || !finiteNumber(entry.additions) || !finiteNumber(entry.deletions))
      return [];
    return [
      {
        path: entry.path,
        status: parsedStatus,
        additions: entry.additions,
        deletions: entry.deletions,
        ...(typeof entry.renamedFrom === 'string' ? { renamedFrom: entry.renamedFrom } : {}),
        ...(parsedStatus === 'binary' ? { binary: true } : {}),
      },
    ];
  });
  const snapshotId = changes.map((file) => file.path).join('|');
  const parsedAnnotations = annotations(value.annotations);
  if (parsedAnnotations === null) return null;
  const document = buildDiffMapDocument(changes, {
    source: { kind: 'chat-turn', sessionId: 'rich-block', turnId: 'rich-block', snapshotId },
  });
  if (
    !annotationsReferenceFiles(
      parsedAnnotations,
      new Set(document.files.map((file) => file.id)),
      new Set(document.files.map((file) => file.path)),
    )
  ) {
    return null;
  }
  return { ...document, annotations: parsedAnnotations };
}

export function parseDiffMapDocument(value: unknown): DiffMapDocument | null {
  if (!record(value)) return null;
  return 'source' in value || 'groups' in value ? fullDocument(value) : compactDocument(value);
}
