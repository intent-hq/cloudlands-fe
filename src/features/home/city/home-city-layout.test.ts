import { describe, expect, it } from 'vitest';
import { createCityFixture, createReservedCityLayout } from './home-city-fixtures';
import { allocateCityLayout } from './home-city-allocation';
import {
  cityPlotPosition,
  emptyCityLayout,
  normalizeCityLayout,
  type CityLayout,
} from './home-city-layout';

// Prevent detached neighborhoods, overlapping buildings, lost reservations,
// nondeterministic placement, and moving addresses when Home hides or adds work.
const positions = (layout: CityLayout) =>
  new Map(
    layout.plots.map((plot) => [
      plot.id,
      cityPlotPosition(
        plot,
        layout.districts.find((district) => district.id === plot.districtId)!,
      ),
    ]),
  );

function connected(blocks: { x: number; z: number }[]): boolean {
  const remaining = new Set(blocks.map((block) => `${block.x}:${block.z}`));
  const pending = blocks.slice(0, 1);
  for (let i = 0; i < pending.length; i++) {
    const block = pending[i];
    remaining.delete(`${block.x}:${block.z}`);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = { x: block.x + dx, z: block.z + dz };
      if (remaining.delete(`${next.x}:${next.z}`)) pending.push(next);
    }
  }
  return remaining.size === 0;
}

describe('repository neighborhoods on a shared city grid', () => {
  it.each(['two-hundred', 'many-repositories', 'skewed'] as const)(
    'forms a compact connected city with separate contiguous repos for %s',
    (scenario) => {
      const layout = allocateCityLayout(createCityFixture(scenario), emptyCityLayout());
      expect(layout.districts).toHaveLength(scenario === 'two-hundred' ? 3 : 25);
      expect(layout.plots).toHaveLength(200);
      const blocks = layout.districts.flatMap((district) => district.blocks);
      expect(new Set(blocks.map((block) => `${block.x}:${block.z}`)).size).toBe(blocks.length);
      expect(blocks.every((block) => Number.isInteger(block.x) && Number.isInteger(block.z))).toBe(
        true,
      );
      expect(connected(blocks)).toBe(true);
      for (const district of layout.districts) expect(connected(district.blocks)).toBe(true);
      const width = Math.max(...blocks.map((b) => b.x)) - Math.min(...blocks.map((b) => b.x)) + 1;
      const depth = Math.max(...blocks.map((b) => b.z)) - Math.min(...blocks.map((b) => b.z)) + 1;
      expect(width * depth).toBeLessThanOrEqual(blocks.length * 2);
      const points = layout.plots.map((plot) => ({
        ...positions(layout).get(plot.id)!,
        size: plot.cell === undefined ? 3 : 0.65,
      }));
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const gap = (points[i].size + points[j].size) / 2;
          expect(
            Math.max(
              Math.abs(points[i].x - points[j].x) - gap,
              Math.abs(points[i].z - points[j].z) - gap,
            ),
          ).toBeGreaterThanOrEqual(-1e-8);
        }
      }
    },
  );

  it('is deterministic regardless of arrival order, title, or status', () => {
    const model = createCityFixture('many-repositories');
    const original = allocateCityLayout(model, emptyCityLayout());
    expect(
      allocateCityLayout(
        {
          repositories: [...model.repositories].reverse(),
          buildings: [...model.buildings].reverse().map((building) => ({
            ...building,
            title: 'Renamed',
            status: 'complete' as const,
          })),
        },
        emptyCityLayout(),
      ),
    ).toEqual(original);
  });

  it('packs sixteen native one-tile workspaces into one lot and spills without overlap', () => {
    const model = createCityFixture('packed');
    const layout = allocateCityLayout(model, emptyCityLayout());
    const small = layout.plots.filter((plot) => plot.cell !== undefined);
    expect(small).toHaveLength(18);
    expect(new Set(small.slice(0, 16).map((plot) => plot.slot)).size).toBe(1);
    expect(new Set(small.slice(0, 16).map((plot) => plot.cell)).size).toBe(16);
    expect(new Set(small.slice(16).map((plot) => plot.slot)).size).toBe(1);
    expect(small[16].slot).not.toBe(small[0].slot);
    const large = layout.plots.filter((plot) => plot.cell === undefined);
    expect(large).toHaveLength(2);
    expect(new Set(layout.plots.map((plot) => plot.slot)).size).toBe(4);
    expect(layout.districts[0].blocks).toHaveLength(1);
    const addresses = [...positions(layout).values()].map(({ x, z }) => `${x}:${z}`);
    expect(new Set(addresses).size).toBe(model.buildings.length);
    expect(normalizeCityLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
  });

  it('reserves hidden compact cells and moves only a workspace that outgrows its cell', () => {
    const model = createCityFixture('packed');
    const original = allocateCityLayout(model, emptyCityLayout());
    const scoped = { ...model, buildings: model.buildings.slice(1, 3) };
    expect(allocateCityLayout(scoped, original)).toBe(original);
    const target = model.buildings[0];
    const promoted = allocateCityLayout(
      {
        ...model,
        buildings: model.buildings.map((building) =>
          building.id === target.id ? { ...building, files: 100, floors: 8 } : building,
        ),
      },
      original,
    );
    const grown = promoted.plots.find((plot) => plot.id === target.id)!;
    expect(grown.cell).toBeUndefined();
    expect(grown.slot).not.toBe(original.plots[0].slot);
    const moved = positions(promoted);
    for (const [id, position] of positions(original)) {
      if (id !== target.id) expect(moved.get(id)).toEqual(position);
    }
    expect(normalizeCityLayout(JSON.parse(JSON.stringify(promoted)))).toEqual(promoted);
  });

  it('rejects duplicate compact cells, invalid cells, and full-lot collisions', () => {
    const layout = allocateCityLayout(createCityFixture('packed'), emptyCityLayout());
    const sample = layout.plots[0];
    const restored = normalizeCityLayout({
      ...layout,
      plots: [
        ...layout.plots,
        { ...sample, id: 'duplicate' },
        { ...sample, id: 'negative', cell: -1 },
        { ...sample, id: 'oversized', cell: 16 },
        { ...sample, id: 'fractional', cell: 1.5 },
        { ...sample, id: 'whole-lot', cell: undefined },
      ],
    });
    expect(restored).toEqual(layout);
  });

  it('migrates ring layouts without losing more than 2,000 reserved workspace IDs', () => {
    const legacy = createReservedCityLayout();
    const migrated = normalizeCityLayout(legacy);
    expect(migrated.version).toBe(3);
    expect(migrated.districts).toHaveLength(1);
    expect(new Set(migrated.plots.map((plot) => plot.id))).toEqual(
      new Set(legacy.plots.map((plot) => plot.id)),
    );
    expect(new Set(migrated.plots.map((plot) => plot.slot)).size).toBe(2002);
    expect(normalizeCityLayout(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  });

  it('migrates filled-island reservations into neighborhoods without losing slots', () => {
    const legacy = {
      version: 2,
      islands: [{ id: 'repo', repositoryId: 'repo', x: 0, z: 0, radius: 15, capacity: 8 }],
      plots: [0, 7].map((slot) => ({
        id: `workspace-${slot}`,
        repositoryId: 'repo',
        islandId: 'repo',
        slot,
      })),
    };
    const migrated = normalizeCityLayout(legacy);
    expect(migrated.districts).toHaveLength(1);
    expect(migrated.plots.map((plot) => [plot.id, plot.slot])).toEqual([
      ['workspace-0', 0],
      ['workspace-7', 7],
    ]);
    expect(normalizeCityLayout(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  });

  it('preserves saved plots when scoping hides work, and after reload', () => {
    const model = createCityFixture('two-hundred');
    const original = allocateCityLayout(model, emptyCityLayout());
    const scoped = { ...model, buildings: model.buildings.slice(-2) };
    expect(allocateCityLayout(scoped, original)).toBe(original);
    const restored = normalizeCityLayout(JSON.parse(JSON.stringify(original)));
    expect(positions(allocateCityLayout(scoped, restored))).toEqual(positions(original));
  });

  it.each(['three', 'many-repositories', 'skewed'] as const)(
    'extends neighborhoods in %s without moving existing addresses',
    (scenario) => {
      const model = createCityFixture(scenario);
      const original = allocateCityLayout(model, emptyCityLayout());
      const growing =
        scenario === 'three'
          ? createCityFixture('two-hundred')
          : {
              ...model,
              buildings: [
                ...model.buildings,
                ...model.repositories.flatMap((repository) => {
                  const sample = model.buildings.find(
                    (building) => building.repositoryId === repository.id,
                  )!;
                  return Array.from({ length: 8 }, (_, index) => ({
                    ...sample,
                    id: `new-${repository.id}-${index}`,
                  }));
                }),
              ],
            };
      const expanded = allocateCityLayout(growing, original);
      const points = positions(expanded);
      for (const [id, position] of positions(original)) expect(points.get(id)).toEqual(position);
      for (const district of expanded.districts) expect(connected(district.blocks)).toBe(true);
      expect(connected(expanded.districts.flatMap((district) => district.blocks))).toBe(true);
      expect(positions(normalizeCityLayout(JSON.parse(JSON.stringify(expanded))))).toEqual(points);
    },
  );

  it('rejects unknown schemas, conflicting blocks, and invalid addresses', () => {
    expect(normalizeCityLayout({ version: 999, districts: [], plots: [] })).toEqual(
      emptyCityLayout(),
    );
    const layout = allocateCityLayout(createCityFixture('two'), emptyCityLayout());
    const restored = normalizeCityLayout({
      ...layout,
      districts: layout.districts.map((district, index) =>
        index === 0 ? { ...district, blocks: [{ x: Infinity, z: 0 }] } : district,
      ),
      plots: [...layout.plots, { ...layout.plots[1], id: 'invalid-slot', slot: -1 }],
    });
    expect(restored.districts).toHaveLength(1);
    expect(restored.plots).toHaveLength(1);
    expect(restored.plots[0].id).toBe(layout.plots[1].id);
    const conflict = normalizeCityLayout({
      ...layout,
      districts: layout.districts.map((district) => ({
        ...district,
        blocks: layout.districts[0].blocks,
      })),
    });
    expect(conflict.districts).toHaveLength(1);
    expect(conflict.plots).toHaveLength(1);
  });
});
