import type { TrackedChange } from '$features/file-tracking/types';
import type { ChatFileChange } from '$lib/utils/get-file-changes-from-messages';
import type {
  DiffMapDocument,
  DiffMapFile,
  DiffMapFileStatus,
  DiffMapGroup,
  DiffMapRepoTreeNode,
  DiffMapSection,
  DiffMapSource,
} from './types';

export interface BuildDiffMapDocumentOptions {
  source: DiffMapSource;
  repoTree?: DiffMapRepoTreeNode;
  patches?: ReadonlyMap<string, string>;
}

interface PatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

interface PatchFacts {
  hunks: PatchHunk[];
  binary: boolean;
  modeOnly: boolean;
  renamedFrom?: string;
}

function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizePath(path: string): string {
  return path
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/^\/+|\/+$/g, '');
}

function splitPath(path: string): { name: string; dir: string } {
  const index = path.lastIndexOf('/');
  return index < 0
    ? { name: path, dir: '' }
    : { name: path.slice(index + 1), dir: path.slice(0, index) };
}

function displayParts(path: string): { displayPrefix: string; displayName: string } {
  if (!path) return { displayPrefix: '', displayName: '' };
  const index = path.lastIndexOf('/');
  return index < 0
    ? { displayPrefix: '', displayName: path }
    : { displayPrefix: `${path.slice(0, index)}/`, displayName: path.slice(index + 1) };
}

function parsePatchFacts(patch: string | undefined): PatchFacts {
  if (!patch) return { hunks: [], binary: false, modeOnly: false };
  const hunks: PatchHunk[] = [];
  const pattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
  for (const match of patch.matchAll(pattern)) {
    hunks.push({
      oldStart: Number(match[1]),
      oldLines: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]),
      newLines: match[4] === undefined ? 1 : Number(match[4]),
    });
  }
  const renamedFrom = patch.match(/^rename from (.+)$/m)?.[1];
  const hasModeHeader = /^(?:old|new) mode \d+$/m.test(patch);
  return {
    hunks,
    binary: /^(?:GIT binary patch|Binary files .+ differ)$/m.test(patch),
    modeOnly: hasModeHeader && hunks.length === 0,
    ...(renamedFrom ? { renamedFrom: normalizePath(renamedFrom) } : {}),
  };
}

function lineCount(content: string | undefined): number | undefined {
  if (content === undefined) return undefined;
  return content === '' ? 0 : content.split('\n').length;
}

function buildTrack(
  hunks: PatchHunk[],
  side: 'old' | 'new',
  knownLineCount?: number,
): number[] | undefined {
  const entries = hunks
    .map((hunk) => ({ start: hunk[`${side}Start`], count: hunk[`${side}Lines`] }))
    .filter(({ count }) => count > 0);
  if (entries.length === 0) return undefined;
  const inferredLineCount = Math.max(...entries.map(({ start, count }) => start + count - 1), 1);
  const total = Math.max(knownLineCount ?? inferredLineCount, inferredLineCount, 1);
  const denominator = Math.max(total - 1, 1);
  return entries.flatMap(({ start, count }) => [
    Math.min(1, Math.max(0, (start - 1 + (count - 1) / 2) / denominator)),
    Math.min(1, count / total),
  ]);
}

function isChatChange(change: TrackedChange | ChatFileChange): change is ChatFileChange {
  return 'filePath' in change;
}

function statusFor(change: TrackedChange | ChatFileChange, facts: PatchFacts): DiffMapFileStatus {
  if (facts.binary || (!isChatChange(change) && change.stats?.binary)) return 'binary';
  if (facts.renamedFrom || (!isChatChange(change) && change.status === 'renamed')) return 'renamed';
  if (facts.modeOnly) return 'mode';
  if (isChatChange(change)) {
    return change.action === 'create'
      ? 'added'
      : change.action === 'delete'
        ? 'deleted'
        : 'modified';
  }
  return change.status ?? 'modified';
}

function toFile(
  change: TrackedChange | ChatFileChange,
  patches: ReadonlyMap<string, string> | undefined,
): DiffMapFile | undefined {
  const rawPath = isChatChange(change) ? change.filePath : change.relativePath || change.file;
  const path = normalizePath(rawPath);
  if (!path) return undefined;
  const { name, dir } = splitPath(path);
  const additions = isChatChange(change) ? change.additions : change.stats?.additions;
  const deletions = isChatChange(change) ? change.deletions : change.stats?.deletions;
  const statsKnown = Number.isFinite(additions) && Number.isFinite(deletions);
  const patch = patches?.get(path) ?? patches?.get(rawPath);
  const facts = parsePatchFacts(patch);
  const oldContent = isChatChange(change) ? change.oldContent : change.content?.oldContent;
  const newContent = isChatChange(change) ? change.newContent : change.content?.newContent;
  const fullContents = isChatChange(change)
    ? change.isFullFileContent === true
    : change.content?.isFullFileContent === true;
  const oldTrack = buildTrack(facts.hunks, 'old', fullContents ? lineCount(oldContent) : undefined);
  const newTrack = buildTrack(facts.hunks, 'new', fullContents ? lineCount(newContent) : undefined);
  const contentHash = !isChatChange(change)
    ? (change.content?.newContentSha ?? change.content?.diffSha ?? change.content?.oldContentSha)
    : undefined;
  return {
    id: path,
    path,
    name,
    dir,
    status: statusFor(change, facts),
    additions: statsKnown ? additions : 0,
    deletions: statsKnown ? deletions : 0,
    statsKnown,
    ...(facts.renamedFrom ? { renamedFrom: facts.renamedFrom } : {}),
    ...(oldTrack ? { oldTrack } : {}),
    ...(newTrack ? { newTrack } : {}),
    ...(!isChatChange(change) && change.attribution ? { attribution: change.attribution } : {}),
    ...(contentHash ? { contentHash } : {}),
  };
}

function findTreeNode(root: DiffMapRepoTreeNode, path: string): DiffMapRepoTreeNode | undefined {
  if (!path) return root;
  let best: DiffMapRepoTreeNode | undefined;
  const visit = (node: DiffMapRepoTreeNode) => {
    const nodePath = normalizePath(node.path);
    if (
      nodePath === path ||
      (nodePath.endsWith(`/${path}`) &&
        (!best || normalizePath(best.path).split('/').length > nodePath.split('/').length))
    ) {
      best = node;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return best;
}

function countFiles(node: DiffMapRepoTreeNode): number {
  if (node.type === 'file') return 1;
  return (node.children ?? []).reduce((sum, child) => sum + countFiles(child), 0);
}

function buildGroups(files: DiffMapFile[], repoTree?: DiffMapRepoTreeNode): DiffMapGroup[] {
  const byDirectory = new Map<string, string[]>();
  for (const file of files) {
    const ids = byDirectory.get(file.dir) ?? [];
    ids.push(file.id);
    byDirectory.set(file.dir, ids);
  }
  return [...byDirectory.entries()]
    .sort(([a], [b]) => comparePaths(a, b))
    .map(([path, fileIds]) => {
      const treeNode = repoTree ? findTreeNode(repoTree, path) : undefined;
      return {
        id: path || '.',
        path,
        ...displayParts(path),
        fileIds: fileIds.sort(comparePaths),
        changedCount: fileIds.length,
        ...(treeNode ? { totalCount: countFiles(treeNode) } : {}),
      };
    });
}

function commonDirectoryPrefix(groups: DiffMapGroup[]): string[] {
  if (groups.length === 0) return [];
  const parts = groups.map((group) => group.path.split('/').filter(Boolean));
  const prefix: string[] = [];
  for (let index = 0; parts.every((path) => path[index] === parts[0][index]); index++) {
    if (parts[0][index] === undefined) break;
    prefix.push(parts[0][index]);
  }
  return prefix;
}

function buildSections(
  groups: DiffMapGroup[],
  repoTree?: DiffMapRepoTreeNode,
): DiffMapSection[] | undefined {
  const prefix = commonDirectoryPrefix(groups);
  if (groups.some((group) => group.path.split('/').filter(Boolean).length <= prefix.length)) {
    return undefined;
  }
  const sectionPaths = [
    ...new Set(
      groups.map((group) =>
        group.path
          .split('/')
          .filter(Boolean)
          .slice(0, prefix.length + 1)
          .join('/'),
      ),
    ),
  ].sort(comparePaths);
  if (sectionPaths.length < 2) return undefined;
  return sectionPaths.map((path) => {
    const groupIds = groups
      .filter((group) => group.path === path || group.path.startsWith(`${path}/`))
      .map((group) => group.id);
    const changedCount = groups
      .filter((group) => groupIds.includes(group.id))
      .reduce((sum, group) => sum + group.changedCount, 0);
    const treeNode = repoTree ? findTreeNode(repoTree, path) : undefined;
    return {
      id: path,
      path,
      ...displayParts(path),
      groupIds,
      changedCount,
      ...(treeNode ? { totalCount: countFiles(treeNode) } : {}),
    };
  });
}

export function buildDiffMapDocument(
  changes: TrackedChange[] | ChatFileChange[],
  opts: BuildDiffMapDocumentOptions,
): DiffMapDocument {
  const filesById = new Map<string, DiffMapFile>();
  for (const change of changes) {
    const file = toFile(change, opts.patches);
    if (file) filesById.set(file.id, file);
  }
  const files = [...filesById.values()].sort((a, b) => comparePaths(a.path, b.path));
  const groups = buildGroups(files, opts.repoTree);
  const sections = buildSections(groups, opts.repoTree);
  return {
    source: opts.source,
    files,
    groups,
    ...(sections ? { sections } : {}),
    annotations: [],
  };
}
