import { describe, expect, it } from 'vitest';
import {
  diffMapFixtures,
  edgeDiffMapFixture,
  hugeDiffMapFixture,
  largeDiffMapFixture,
  typicalDiffMapFixture,
} from '../model/fixtures';
import type { DiffMapDocument } from '../model/types';
import {
  diffMapGroupCountLabel,
  diffLayouts,
  layoutDiffMap,
  shouldRelayoutDiffMap,
  type DiffMapLayout,
  type LayoutRect,
  type TextMeasurer,
} from './layout-diff-map';

const measure: TextMeasurer = (text, context) => text.length * (context.role === 'file' ? 7 : 7.5);
const widths = [280, 480, 720, 900, 1400];
const heights = [400, 500, 900];

function rows(layout: DiffMapLayout) {
  return layout.blocks.flatMap((block) => block.columns.flatMap((column) => column.rows));
}

function overlaps(a: LayoutRect, b: LayoutRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function expectNoOverlaps(rects: LayoutRect[]) {
  for (let first = 0; first < rects.length; first++) {
    for (let second = first + 1; second < rects.length; second++) {
      if (overlaps(rects[first], rects[second])) {
        throw new Error(`rectangles ${first} and ${second} overlap`);
      }
    }
  }
}

function expectValidLayout(document: DiffMapDocument, layout: DiffMapLayout, width: number) {
  const placedRows = rows(layout);
  expect(placedRows.map((row) => row.fileId).sort()).toEqual(
    document.files.map((file) => file.id).sort(),
  );
  expect(new Set(placedRows.map((row) => row.fileId)).size).toBe(document.files.length);
  for (const block of layout.blocks) {
    expect(block.x).toBeGreaterThanOrEqual(0);
    expect(block.x + block.w).toBeLessThanOrEqual(width);
  }
  for (const row of placedRows) {
    expect(row.x).toBeGreaterThanOrEqual(0);
    expect(row.x + row.w).toBeLessThanOrEqual(width);
  }
  expectNoOverlaps(layout.blocks);
  expectNoOverlaps(placedRows);
}

function widestShelf(layout: DiffMapLayout): number {
  const shelves = new Map<number, DiffMapLayout['blocks']>();
  for (const block of layout.blocks) shelves.set(block.y, [...(shelves.get(block.y) ?? []), block]);
  return Math.max(
    ...[...shelves.values()].map((shelf) => Math.max(...shelf.map((block) => block.x + block.w))),
  );
}

function shelfDocument(groupSizes: number[], fileName = 'file.ts'): DiffMapDocument {
  const template = typicalDiffMapFixture.document.files[0];
  const files = groupSizes.flatMap((size, groupIndex) =>
    Array.from({ length: size }, (_, fileIndex) => ({
      ...template,
      id: `group-${groupIndex}/file-${fileIndex}`,
      path: `group-${groupIndex}/${fileName}-${fileIndex}`,
      name: fileName,
    })),
  );
  let fileOffset = 0;
  const groups = groupSizes.map((size, groupIndex) => {
    const fileIds = files.slice(fileOffset, fileOffset + size).map((file) => file.id);
    fileOffset += size;
    return {
      id: `group-${groupIndex}`,
      displayPrefix: 'src/',
      displayName: `group-${groupIndex}`,
      fileIds,
      changedCount: size,
    };
  });
  return { ...typicalDiffMapFixture.document, files, groups, sections: undefined };
}

function deepHeaderDocument(): DiffMapDocument {
  const document = shelfDocument([1]);
  document.groups[0] = {
    ...document.groups[0],
    id: 'packages/domain-01/layer-0/components',
    path: 'packages/domain-01/layer-0/components',
    displayPrefix: 'packages/domain-01/layer-0/',
    displayName: 'components',
  };
  return document;
}

describe('layoutDiffMap', () => {
  for (const fixture of diffMapFixtures) {
    for (const width of widths) {
      for (const height of heights) {
        it(`places ${fixture.name} exactly once at ${width}x${height}`, () => {
          const layout = layoutDiffMap(fixture.document, { width, height }, measure);
          expectValidLayout(fixture.document, layout, width);
          if (!layout.overflow) expect(layout.contentHeight).toBeLessThanOrEqual(height);
        });
      }
    }
  }

  it('never chooses a sparser rung when width or height shrinks', () => {
    for (const fixture of diffMapFixtures) {
      for (const height of heights) {
        const rungs = [...widths]
          .reverse()
          .map((width) => layoutDiffMap(fixture.document, { width, height }, measure).rung);
        expect(rungs).toEqual([...rungs].sort((a, b) => a - b));
      }
      for (const width of widths) {
        const rungs = [...heights]
          .reverse()
          .map((height) => layoutDiffMap(fixture.document, { width, height }, measure).rung);
        expect(rungs).toEqual([...rungs].sort((a, b) => a - b));
      }
    }
  });

  it('keeps the typical 24-file diff compact at 900x500', () => {
    const layout = layoutDiffMap(
      typicalDiffMapFixture.document,
      { width: 900, height: 500 },
      measure,
    );
    expect(layout.rung).toBeLessThanOrEqual(1);
    expect(layout.overflow).toBe(false);
  });

  it('reports honest rung-3 overflow for 600 files at 280x500', () => {
    const layout = layoutDiffMap(hugeDiffMapFixture.document, { width: 280, height: 500 }, measure);
    expect(layout.rung).toBe(3);
    expect(layout.overflow).toBe(true);
    expect(layout.contentHeight).toBeGreaterThan(500);
  });

  it.each([
    ['large', largeDiffMapFixture.document, 900, 500],
    ['huge', hugeDiffMapFixture.document, 1400, 900],
  ] as const)('fills dense shelves for %s overflow', (_name, document, width, height) => {
    const layout = layoutDiffMap(document, { width, height }, measure);
    expect(layout.overflow).toBe(true);
    expect(widestShelf(layout)).toBeGreaterThanOrEqual(width * 0.85);
    expect(new Set(layout.blocks.map((block) => block.y)).size).toBeLessThan(layout.blocks.length);
  });

  it('stretches a full shelf to the container width and recomputes row label budgets', () => {
    const fileName = 'a-very-long-file-name-for-shelf-stretch.ts';
    const layout = layoutDiffMap(
      shelfDocument([1, 1, 1], fileName),
      { width: 900, height: 500 },
      measure,
      {
        rungOverride: 0,
      },
    );
    const shelves = Map.groupBy(layout.blocks, (block) => block.y);
    const fullShelf = [...shelves.values()][0];
    const lastShelf = [...shelves.values()][1];

    expect(Math.max(...fullShelf.map((block) => block.x + block.w))).toBeCloseTo(900);
    expect(fullShelf[0].columns[0].rows[0].label).toBe(fileName);
    expect(lastShelf[0].columns[0].rows[0].label).not.toBe(fileName);
  });

  it('leaves the last partial shelf left-aligned at base widths', () => {
    const document = shelfDocument([1, 1, 1]);
    document.sections = [
      {
        id: 'src',
        path: 'src',
        displayPrefix: '',
        displayName: 'src',
        groupIds: ['group-0', 'group-1'],
        changedCount: 2,
      },
      {
        id: 'tests',
        path: 'tests',
        displayPrefix: '',
        displayName: 'tests',
        groupIds: ['group-2'],
        changedCount: 1,
      },
    ];
    const layout = layoutDiffMap(document, { width: 500, height: 500 }, measure, {
      rungOverride: 0,
    });
    const shelves = [...Map.groupBy(layout.blocks, (block) => block.y).values()];

    expect(shelves).toHaveLength(2);
    expect(shelves[1][0].x).toBe(0);
    expect(shelves[1][0].w).toBeLessThan(shelves[0][0].w);
  });

  it('stretches the partial shelf when it is the only shelf', () => {
    const layout = layoutDiffMap(shelfDocument([1, 1]), { width: 500, height: 500 }, measure, {
      rungOverride: 0,
    });

    expect(new Set(layout.blocks.map((block) => block.y)).size).toBe(1);
    expect(Math.max(...layout.blocks.map((block) => block.x + block.w))).toBeCloseTo(500);
  });

  it('distributes shelf space proportionally to block column counts', () => {
    const document = shelfDocument([1, 4]);
    const base = layoutDiffMap(document, { width: 576, height: 120 }, measure, { rungOverride: 0 });
    const stretched = layoutDiffMap(document, { width: 900, height: 120 }, measure, {
      rungOverride: 0,
    });
    const additions = stretched.blocks.map((block, index) => block.w - base.blocks[index].w);

    expect(base.blocks.map((block) => block.columns.length)).toEqual([1, 2]);
    expect(additions[1]).toBeCloseTo(additions[0] * 2);
  });

  it('keeps sibling group headers distinct at minimum width', () => {
    const document: DiffMapDocument = {
      ...typicalDiffMapFixture.document,
      groups: typicalDiffMapFixture.document.groups.filter((group) =>
        ['src/lib/auth', 'src/lib/ui'].includes(group.id),
      ),
    };
    const labels = layoutDiffMap(document, { width: 240, height: 500 }, measure, {
      rungOverride: 3,
    }).blocks.map((block) => block.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual(
      expect.arrayContaining([expect.stringContaining('auth'), expect.stringContaining('ui')]),
    );
  });

  it.each([
    [280, '…/domain-01/layer-0/components'],
    [196, '…/layer-0/components'],
    [100, 'components'],
  ])('truncates deep headers at segment boundaries at %ipx', (width, expected) => {
    const block = layoutDiffMap(deepHeaderDocument(), { width, height: 500 }, measure, {
      rungOverride: 3,
    }).blocks[0];

    expect(block.label).toBe(expected);
    expect(block.label).not.toContain('…s/');
  });

  it('strips a rendered section root from its block headers', () => {
    const document = shelfDocument([1, 1, 1]);
    document.groups[0] = {
      ...document.groups[0],
      id: 'src/lib/auth',
      path: 'src/lib/auth',
      displayPrefix: 'src/lib/',
      displayName: 'auth',
    };
    document.groups[1] = {
      ...document.groups[1],
      id: 'src/routes',
      path: 'src/routes',
      displayPrefix: 'src/',
      displayName: 'routes',
    };
    document.groups[2] = {
      ...document.groups[2],
      id: 'tests/auth',
      path: 'tests/auth',
      displayPrefix: 'tests/',
      displayName: 'auth',
    };
    document.sections = [
      {
        id: 'src',
        path: 'src',
        displayPrefix: '',
        displayName: 'src',
        groupIds: ['src/lib/auth', 'src/routes'],
        changedCount: 2,
      },
      {
        id: 'tests',
        path: 'tests',
        displayPrefix: '',
        displayName: 'tests',
        groupIds: ['tests/auth'],
        changedCount: 1,
      },
    ];

    const layout = layoutDiffMap(document, { width: 500, height: 500 }, measure, {
      rungOverride: 0,
    });

    expect(layout.sectionsPlaced.map((section) => section.label)).toEqual(['src', 'tests']);
    expect(layout.blocks.map((block) => block.label)).toEqual(['lib/auth', 'routes', 'auth']);
  });

  it('omits a single root section without stripping it from block headers', () => {
    const document = deepHeaderDocument();
    document.sections = [
      {
        id: 'packages',
        path: 'packages',
        displayPrefix: '',
        displayName: 'packages',
        groupIds: ['packages/domain-01/layer-0/components'],
        changedCount: 1,
      },
    ];

    const layout = layoutDiffMap(document, { width: 500, height: 500 }, measure, {
      rungOverride: 3,
    });

    expect(layout.sectionsPlaced).toEqual([]);
    expect(layout.blocks[0].label).toBe('packages/domain-01/layer-0/components');
  });

  it.each([0, 1, 2] as const)(
    'reserves visible count space without eliding the group name at rung %i',
    (rung) => {
      const displayName = 'authentication';
      const document: DiffMapDocument = {
        ...typicalDiffMapFixture.document,
        files: typicalDiffMapFixture.document.files.slice(0, 1),
        groups: [
          {
            ...typicalDiffMapFixture.document.groups[0],
            displayPrefix: 'packages/',
            displayName,
            fileIds: [typicalDiffMapFixture.document.files[0].id],
          },
        ],
      };
      const block = layoutDiffMap(document, { width: 480, height: 500 }, measure, {
        rungOverride: rung,
      }).blocks[0];
      const labelWidth = measure(block.label, { role: 'group', rung });
      const countWidth = measure(diffMapGroupCountLabel(document.groups[0]), {
        role: 'group',
        rung,
      });

      expect(block.label).toMatch(new RegExp(`${displayName}$`));
      expect(labelWidth + countWidth + 6 + 12).toBeLessThanOrEqual(block.w);
    },
  );

  it('caps long labels with a middle ellipsis', () => {
    const layout = layoutDiffMap(
      edgeDiffMapFixture.document,
      { width: 280, height: 900 },
      measure,
      {
        rungOverride: 3,
      },
    );
    const longRow = rows(layout).find((row) => row.fileId.includes('xxxxxxxx'));
    expect(longRow?.label).toMatch(/^x+…x+\.ts$/);
    expect(measure(longRow?.label ?? '', { role: 'file', rung: 3 })).toBeLessThanOrEqual(246);
  });

  it('preserves repository block order', () => {
    const layout = layoutDiffMap(
      typicalDiffMapFixture.document,
      { width: 900, height: 500 },
      measure,
    );
    expect(layout.blocks.map((block) => block.groupId)).toMatchInlineSnapshot(`
      [
        "src/lib/auth",
        "src/lib/ui",
        "src/routes",
        "tests/auth",
      ]
    `);
  });
});

describe('layout stability', () => {
  it('ignores stat-only updates and applies viewport hysteresis', () => {
    const document = typicalDiffMapFixture.document;
    const statUpdate: DiffMapDocument = {
      ...document,
      files: document.files.map((file) => ({ ...file, additions: file.additions + 100 })),
    };
    const previous = { document, viewport: { width: 900, height: 500 } };
    expect(
      shouldRelayoutDiffMap(previous, {
        document: statUpdate,
        viewport: { width: 900, height: 500 },
      }),
    ).toBe(false);
    expect(
      shouldRelayoutDiffMap(previous, { document, viewport: { width: 876, height: 500 } }),
    ).toBe(false);
    expect(
      shouldRelayoutDiffMap(previous, { document, viewport: { width: 875, height: 500 } }),
    ).toBe(true);
    expect(shouldRelayoutDiffMap(previous, { ...previous, rungOverride: 2 })).toBe(true);
  });

  it('returns ID-keyed row and block rects for FLIP transitions', () => {
    const previous = layoutDiffMap(
      typicalDiffMapFixture.document,
      { width: 900, height: 500 },
      measure,
    );
    const next = layoutDiffMap(
      typicalDiffMapFixture.document,
      { width: 480, height: 500 },
      measure,
    );
    const delta = diffLayouts(previous, next);
    expect(delta.blocks.map((entry) => entry.groupId)).toEqual(
      typicalDiffMapFixture.document.groups.map((group) => group.id),
    );
    expect(delta.rows).toHaveLength(24);
    expect(delta.rows.every((entry) => entry.from && entry.to)).toBe(true);
  });
});
