import { describe, expect, it } from 'vitest';
import { createCityFixture, createReservedCityLayout } from './home-city-fixtures';
import {
  allocateCityLayout,
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
      const points = [...positions(layout).values()];
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          expect(Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z)).toBeGreaterThan(
            2.8,
          );
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
