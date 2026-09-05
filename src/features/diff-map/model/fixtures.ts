import { ChangeStage, type TrackedChange } from '$features/file-tracking/types';
import { buildDiffMapDocument, type BuildDiffMapDocumentOptions } from './build-document';
import type { DiffMapDocument, DiffMapFileStatus, DiffMapRepoTreeNode } from './types';

export interface DiffMapFixture {
  name: 'tiny' | 'typical' | 'large' | 'huge' | 'monorepo' | 'edge';
  changes: TrackedChange[];
  options: BuildDiffMapDocumentOptions;
  document: DiffMapDocument;
}

function change(
  path: string,
  additions: number,
  deletions: number,
  status: Exclude<DiffMapFileStatus, 'binary' | 'mode'> = 'modified',
): TrackedChange {
  return {
    id: `fixture:${path}`,
    file: path,
    relativePath: path,
    stage: ChangeStage.Unstaged,
    status,
    stats: { additions, deletions },
    attribution: { manual: true, timestamp: 0 },
  };
}

function source(name: string): BuildDiffMapDocumentOptions['source'] {
  return { kind: 'working-tree', workspaceId: 'fixture', snapshotId: name };
}

function fixture(
  name: DiffMapFixture['name'],
  changes: TrackedChange[],
  extra: Partial<BuildDiffMapDocumentOptions> = {},
): DiffMapFixture {
  const options: BuildDiffMapDocumentOptions = { source: source(name), ...extra };
  return { name, changes, options, document: buildDiffMapDocument(changes, options) };
}

const tinyChanges = [
  change('src/index.ts', 4, 1),
  change('src/lib/format.ts', 12, 3),
  change('tests/format.test.ts', 18, 0, 'added'),
];

const tinyTree: DiffMapRepoTreeNode = {
  name: 'repo',
  path: '',
  type: 'directory',
  children: [
    {
      name: 'src',
      path: 'src',
      type: 'directory',
      children: [
        { name: 'index.ts', path: 'src/index.ts', type: 'file' },
        {
          name: 'lib',
          path: 'src/lib',
          type: 'directory',
          children: [
            { name: 'format.ts', path: 'src/lib/format.ts', type: 'file' },
            { name: 'parse.ts', path: 'src/lib/parse.ts', type: 'file' },
          ],
        },
      ],
    },
    {
      name: 'tests',
      path: 'tests',
      type: 'directory',
      children: [{ name: 'format.test.ts', path: 'tests/format.test.ts', type: 'file' }],
    },
  ],
};

const typicalRows: Array<[string, number, number, TrackedChange['status']?]> = [
  ['src/lib/auth/access.ts', 12, 4],
  ['src/lib/auth/claims.ts', 31, 9],
  ['src/lib/auth/policy.ts', 84, 0, 'added'],
  ['src/lib/auth/roles.ts', 7, 2],
  ['src/lib/auth/session.ts', 0, 0, 'renamed'],
  ['src/lib/auth/token.ts', 22, 8],
  ['src/lib/ui/Badge.svelte', 8, 2],
  ['src/lib/ui/Button.svelte', 11, 3],
  ['src/lib/ui/Dialog.svelte', 44, 8],
  ['src/lib/ui/Notice.svelte', 39, 0, 'added'],
  ['src/lib/ui/Panel.svelte', 16, 4],
  ['src/lib/ui/index.ts', 2, 0],
  ['src/routes/+layout.ts', 8, 2],
  ['src/routes/+page.svelte', 62, 8],
  ['src/routes/login.svelte', 18, 3],
  ['src/routes/logout.ts', 14, 0, 'added'],
  ['src/routes/settings.ts', 21, 6],
  ['src/routes/legacy.ts', 0, 9, 'deleted'],
  ['tests/auth/access.test.ts', 28, 4],
  ['tests/auth/claims.test.ts', 61, 0, 'added'],
  ['tests/auth/login.test.ts', 32, 6],
  ['tests/auth/roles.test.ts', 15, 2],
  ['tests/auth/session.test.ts', 48, 0, 'added'],
  ['tests/auth/token.test.ts', 26, 5],
];

const typicalChanges = typicalRows.map(([path, additions, deletions, status]) =>
  change(path, additions, deletions, status),
);

const typicalPatches = new Map(
  typicalChanges.map((item, index) => [
    item.relativePath,
    `@@ -${index + 2},2 +${index * 2 + 3},3 @@\n-old\n+new`,
  ]),
);

function generatedChanges(
  prefix: string,
  directoryCount: number,
  fileCount: number,
): TrackedChange[] {
  return Array.from({ length: fileCount }, (_, index) => {
    const directory = index % directoryCount;
    const path = `${prefix}/domain-${String(directory + 1).padStart(2, '0')}/layer-${directory % 3}/components/file-${String(index + 1).padStart(3, '0')}.ts`;
    return change(
      path,
      (index * 7) % 89,
      (index * 3) % 34,
      index % 17 === 0 ? 'added' : 'modified',
    );
  });
}

const monorepoChanges = [
  change('packages/cloudlands-fe/src/app.ts', 12, 2),
  change('packages/cloudlands-fe/src/routes/+page.svelte', 30, 6),
  change('packages/cloudlands-fe/tests/app.test.ts', 22, 0, 'added'),
  change('packages/intentd/crates/core/src/lib.rs', 18, 4),
  change('packages/intentd/crates/store/src/sqlite.rs', 41, 9),
  change('packages/intentd/tests/rpc.rs', 25, 3),
];

const longName = `${'x'.repeat(87)}.ts`;
const edgeChanges = [
  change('edge/new-name.ts', 0, 0, 'renamed'),
  { ...change('edge/image.png', 0, 0), stats: { additions: 0, deletions: 0, binary: true } },
  change('edge/executable.sh', 0, 0),
  change('edge/deleted.ts', 0, 42, 'deleted'),
  change(`edge/${longName}`, 1, 1),
  { ...change('edge/unknown.ts', Number.NaN, Number.NaN) },
];

const edgePatches = new Map<string, string>([
  [
    'edge/new-name.ts',
    'similarity index 100%\nrename from edge/old-name.ts\nrename to edge/new-name.ts',
  ],
  ['edge/image.png', 'Binary files a/edge/image.png and b/edge/image.png differ'],
  ['edge/executable.sh', 'old mode 100644\nnew mode 100755'],
]);

export const tinyDiffMapFixture = fixture('tiny', tinyChanges, { repoTree: tinyTree });
export const typicalDiffMapFixture = fixture('typical', typicalChanges, {
  patches: typicalPatches,
});
export const largeDiffMapFixture = fixture('large', generatedChanges('src', 18, 120));
export const hugeDiffMapFixture = fixture('huge', generatedChanges('packages', 30, 600));
export const monorepoDiffMapFixture = fixture('monorepo', monorepoChanges);
export const edgeDiffMapFixture = fixture('edge', edgeChanges, { patches: edgePatches });

export const diffMapFixtures = [
  tinyDiffMapFixture,
  typicalDiffMapFixture,
  largeDiffMapFixture,
  hugeDiffMapFixture,
  monorepoDiffMapFixture,
  edgeDiffMapFixture,
] as const;
