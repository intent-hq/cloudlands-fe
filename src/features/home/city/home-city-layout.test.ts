import { describe, expect, it } from 'vitest';
import { createCityFixture, createReservedCityLayout } from './home-city-fixtures';
import {
  allocateCityLayout,
  cityPlotPosition,
  emptyCityLayout,
  normalizeCityLayout,
  type CityLayout,
} from './home-city-layout';

// Prevent overlapping buildings/islands, fragmented repos, lost reservations,
// nondeterministic placement, and reshuffling when Home hides workspaces.
const positions = (layout: CityLayout) =>
  new Map(
    layout.plots.map((plot) => [
      plot.id,
      cityPlotPosition(
        plot,
        layout.islands.find((island) => island.id === plot.islandId)!,
      ),
    ]),
  );

describe('repository island layout', () => {
  it('keeps a large repository on one island and leaves room between buildings', () => {
    const model = createCityFixture('two-hundred');
    const layout = allocateCityLayout(model, emptyCityLayout());
    expect(layout.islands).toHaveLength(3);
    expect(layout.plots).toHaveLength(200);
    const points = positions(layout);
    for (const island of layout.islands) {
      const plots = layout.plots.filter((plot) => plot.islandId === island.id);
      for (let i = 0; i < plots.length; i++) {
        const a = points.get(plots[i].id)!;
        expect(Math.hypot(a.x - island.x, a.z - island.z)).toBeLessThan(island.radius - 1.8);
        for (let j = i + 1; j < plots.length; j++) {
          const b = points.get(plots[j].id)!;
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2.8);
        }
      }
    }
  });

  it.each(['many-repositories', 'skewed'] as const)(
    'packs %s with clear gaps and a nearby neighbor for every island',
    (scenario) => {
      const layout = allocateCityLayout(createCityFixture(scenario), emptyCityLayout());
      expect(layout.islands).toHaveLength(25);
      for (const island of layout.islands) {
        const gaps = layout.islands
          .filter((other) => other.id !== island.id)
          .map(
            (other) =>
              Math.hypot(other.x - island.x, other.z - island.z) - island.radius - other.radius,
          );
        expect(Math.min(...gaps)).toBeGreaterThan(2.5);
        expect(Math.min(...gaps)).toBeLessThan(4);
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
          buildings: [...model.buildings]
            .reverse()
            .map((building) => ({ ...building, title: 'Renamed', status: 'complete' as const })),
        },
        emptyCityLayout(),
      ),
    ).toEqual(original);
  });

  it('migrates ring layouts without losing more than 2,000 reserved workspace IDs', () => {
    const legacy = createReservedCityLayout();
    const migrated = normalizeCityLayout(legacy);
    expect(migrated.version).toBe(2);
    expect(migrated.islands).toHaveLength(1);
    expect(new Set(migrated.plots.map((plot) => plot.id))).toEqual(
      new Set(legacy.plots.map((plot) => plot.id)),
    );
    expect(new Set(migrated.plots.map((plot) => plot.slot)).size).toBe(2002);
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

  it('rejects unknown schemas and invalid coordinates without accepting unsafe plots', () => {
    expect(normalizeCityLayout({ version: 999, islands: [], plots: [] })).toEqual(
      emptyCityLayout(),
    );
    const layout = allocateCityLayout(createCityFixture('two'), emptyCityLayout());
    const restored = normalizeCityLayout({
      ...layout,
      islands: layout.islands.map((island, index) =>
        index === 0 ? { ...island, x: Infinity } : island,
      ),
      plots: [...layout.plots, { ...layout.plots[1], id: 'invalid-slot', slot: -1 }],
    });
    expect(restored.islands).toHaveLength(1);
    expect(restored.plots).toHaveLength(1);
    expect(restored.plots[0].id).toBe(layout.plots[1].id);
  });
});
