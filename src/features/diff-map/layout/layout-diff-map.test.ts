import { describe, expect, it } from 'vitest';
import {
  diffMapFixtures,
  edgeDiffMapFixture,
  hugeDiffMapFixture,
  typicalDiffMapFixture,
} from '../model/fixtures';
import type { DiffMapDocument } from '../model/types';
import {
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
