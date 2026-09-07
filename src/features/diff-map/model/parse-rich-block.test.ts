import { describe, expect, it } from 'vitest';
import { tinyDiffMapFixture } from './fixtures';
import { parseDiffMapDocument } from './parse-rich-block';

describe('parseDiffMapDocument', () => {
  it('accepts full-document sections that reference known groups', () => {
    const group = tinyDiffMapFixture.document.groups[0];
    const document = {
      ...tinyDiffMapFixture.document,
      sections: [
        {
          id: 'section:src',
          path: 'src',
          displayPrefix: '',
          displayName: 'src',
          groupIds: [group.id],
          changedCount: group.changedCount,
        },
      ],
    };

    expect(parseDiffMapDocument(document)?.sections).toEqual(document.sections);
  });

  it.each([
    [{ id: 'section:src', groupIds: null }],
    [
      {
        id: 'section:src',
        path: 'src',
        displayPrefix: '',
        displayName: 'src',
        groupIds: ['group:missing'],
        changedCount: 1,
      },
    ],
  ])('rejects malformed or dangling sections without throwing', (sections) => {
    const document = { ...tinyDiffMapFixture.document, sections };

    expect(() => parseDiffMapDocument(document)).not.toThrow();
    expect(parseDiffMapDocument(document)).toBeNull();
  });

  it.each([
    [
      'dangling file ID',
      (document: typeof tinyDiffMapFixture.document) => {
        document.groups[0].fileIds = ['missing.ts'];
      },
    ],
    [
      'duplicate file ID in a group',
      (document: typeof tinyDiffMapFixture.document) => {
        document.groups[0].fileIds.push(document.groups[0].fileIds[0]);
        document.groups[0].changedCount += 1;
      },
    ],
    [
      'count mismatch',
      (document: typeof tinyDiffMapFixture.document) => {
        document.groups[0].changedCount += 1;
      },
    ],
    [
      'duplicate group ID',
      (document: typeof tinyDiffMapFixture.document) => {
        document.groups.push({ ...document.groups[0], fileIds: [], changedCount: 0 });
      },
    ],
    [
      'duplicate file ID',
      (document: typeof tinyDiffMapFixture.document) => {
        document.files[1].id = document.files[0].id;
      },
    ],
    [
      'file covered by multiple groups',
      (document: typeof tinyDiffMapFixture.document) => {
        document.groups.push({
          ...document.groups[0],
          id: 'duplicate-membership',
          fileIds: [document.groups[0].fileIds[0]],
          changedCount: 1,
        });
      },
    ],
    [
      'uncovered file',
      (document: typeof tinyDiffMapFixture.document) => {
        document.groups[0].fileIds = document.groups[0].fileIds.slice(1);
        document.groups[0].changedCount -= 1;
      },
    ],
  ])('rejects a document with %s', (_, mutate) => {
    const document = structuredClone(tinyDiffMapFixture.document);
    mutate(document);

    expect(() => parseDiffMapDocument(document)).not.toThrow();
    expect(parseDiffMapDocument(document)).toBeNull();
  });

  it.each([
    [
      'duplicate section ID',
      (document: typeof tinyDiffMapFixture.document & { sections?: unknown[] }) => {
        const group = document.groups[0];
        document.sections = [
          {
            id: 'section:src',
            path: 'src',
            displayPrefix: '',
            displayName: 'src',
            groupIds: [group.id],
            changedCount: group.changedCount,
          },
          {
            id: 'section:src',
            path: 'other',
            displayPrefix: '',
            displayName: 'other',
            groupIds: [],
            changedCount: 0,
          },
        ];
      },
    ],
    [
      'duplicate annotation ID',
      (document: typeof tinyDiffMapFixture.document) => {
        document.annotations = [
          { id: 'fact:1', kind: 'test', fileId: document.files[0].id },
          { id: 'fact:1', kind: 'review', fileId: document.files[1].id },
        ];
      },
    ],
    [
      'dangling fact annotation target',
      (document: typeof tinyDiffMapFixture.document) => {
        document.annotations = [{ id: 'fact:1', kind: 'test', fileId: 'missing.ts' }];
      },
    ],
    [
      'dangling path annotation target',
      (document: typeof tinyDiffMapFixture.document) => {
        document.annotations = [
          { id: 'group:1', kind: 'group', label: 'Missing', paths: ['missing.ts'] },
        ];
      },
    ],
  ])('rejects a full document with %s', (_, mutate) => {
    const document = structuredClone(tinyDiffMapFixture.document);
    mutate(document);

    expect(() => parseDiffMapDocument(document)).not.toThrow();
    expect(parseDiffMapDocument(document)).toBeNull();
  });

  it.each([
    ['an odd track', { oldTrack: [0.5] }],
    ['a non-numeric track', { oldTrack: [0.5, 'large'] }],
    ['an out-of-range track', { newTrack: [1.2, 0.5] }],
    ['an inverted hunk', { hunks: [{ oldRange: { start: 4, end: 3 } }] }],
    ['an empty hunk', { hunks: [{}] }],
  ])('rejects a file with %s', (_, malformed) => {
    const document = structuredClone(tinyDiffMapFixture.document);
    Object.assign(document.files[0], malformed);

    expect(() => parseDiffMapDocument(document)).not.toThrow();
    expect(parseDiffMapDocument(document)).toBeNull();
  });

  it('accepts compact status facts and drops unknown annotation kinds', () => {
    const parsed = parseDiffMapDocument({
      files: [
        { path: 'src/binary.dat', status: 'binary', additions: 0, deletions: 0 },
        { path: 'src/mode.sh', status: 'mode', additions: 0, deletions: 0 },
      ],
      annotations: [
        { kind: 'group', label: 'Core', paths: ['src/mode.sh'] },
        {
          kind: 'claim',
          label: 'Claimed',
          paths: ['src/binary.dat'],
          provenance: { agentId: 'agent-1' },
        },
        {
          kind: 'test',
          fileId: 'src/mode.sh',
          oldRange: { start: 1, end: 2 },
          data: { passed: true },
        },
        { kind: 'future-kind', label: 'ignored' },
      ],
    });

    expect(parsed?.files.map((file) => file.status)).toEqual(['binary', 'mode']);
    expect(parsed?.annotations.map((annotation) => annotation.kind)).toEqual([
      'group',
      'claim',
      'test',
    ]);
    expect(parsed?.annotations.map((annotation) => annotation.id)).toEqual([
      'group:0',
      'claim:1',
      'test:2',
    ]);
  });

  it('normalizes compact paths without losing authoritative status facts', () => {
    const compact = {
      files: [
        { path: './src/added.ts', status: 'added', additions: 1, deletions: 0 },
        { path: 'src\\deleted.ts', status: 'deleted', additions: 0, deletions: 2 },
      ],
    };

    expect(() => parseDiffMapDocument(compact)).not.toThrow();
    expect(parseDiffMapDocument(compact)?.files).toEqual([
      expect.objectContaining({ path: 'src/added.ts', status: 'added' }),
      expect.objectContaining({ path: 'src/deleted.ts', status: 'deleted' }),
    ]);
  });

  it.each([
    { kind: 'claim', label: 'malformed', paths: 'src/mode.sh', provenance: 'agent' },
    { kind: 'comment', oldRange: { start: 3, end: 2 } },
    { kind: 'group', label: 'malformed', paths: [1] },
  ])('rejects malformed supported annotations without throwing', (annotation) => {
    const compact = {
      files: [{ path: 'src/file.ts', status: 'modified', additions: 1, deletions: 1 }],
      annotations: [annotation],
    };

    expect(() => parseDiffMapDocument(compact)).not.toThrow();
    expect(parseDiffMapDocument(compact)).toBeNull();
  });

  it('returns a fresh document containing only validated fields', () => {
    const document = structuredClone(
      tinyDiffMapFixture.document,
    ) as typeof tinyDiffMapFixture.document & {
      untrusted?: string;
    };
    document.untrusted = 'discard me';

    const parsed = parseDiffMapDocument(document);

    expect(parsed).not.toBe(document);
    expect(parsed).not.toHaveProperty('untrusted');
    expect(parsed?.files[0]).not.toBe(document.files[0]);
  });
});
