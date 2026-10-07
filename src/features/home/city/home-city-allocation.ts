import type { CityModel } from './home-city-model';
import { CITY_COMPACT_CELLS, reserveCityBlocks, type CityLayout } from './home-city-layout';
import { cityBuildingSprite, cityRepositoryZone } from './home-city-sprites';

/** Keep native sprite selection out of saved-layout validation used across processes. */
export function allocateCityLayout(model: CityModel, previous: CityLayout): CityLayout {
  const existing = new Map(previous.plots.map((plot) => [plot.id, plot]));
  const zones = new Map(model.repositories.map((repo) => [repo.id, cityRepositoryZone(repo)]));
  const compact = new Map(
    model.buildings.map((building) => {
      const sprite = cityBuildingSprite(
        building,
        zones.get(building.repositoryId) ?? 'residential',
      );
      return [building.id, sprite.lot[0] === 1 && sprite.lot[1] === 1];
    }),
  );
  const newcomers = model.buildings.filter((building) => {
    const plot = existing.get(building.id);
    return (
      plot?.repositoryId !== building.repositoryId ||
      (plot.cell !== undefined) !== compact.get(building.id)
    );
  });
  if (newcomers.length === 0) return previous;
  const incoming = new Set(newcomers.map((building) => building.id));
  const layout: CityLayout = {
    version: 3,
    districts: previous.districts.map((district) => ({
      ...district,
      blocks: [...district.blocks],
    })),
    plots: previous.plots.filter((plot) => !incoming.has(plot.id)),
  };
  const districts = new Map(layout.districts.map((district) => [district.repositoryId, district]));
  const occupied = new Map<string, Map<number, Set<number>>>();
  for (const plot of layout.plots) {
    let slots = occupied.get(plot.repositoryId);
    if (!slots) occupied.set(plot.repositoryId, (slots = new Map()));
    const cells = slots.get(plot.slot) ?? new Set<number>();
    cells.add(plot.cell ?? -1);
    slots.set(plot.slot, cells);
  }
  // A scoped model cannot distinguish deleted workspaces from hidden reservations.
  for (const building of [...newcomers].sort(
    (a, b) => a.repositoryId.localeCompare(b.repositoryId) || a.id.localeCompare(b.id),
  )) {
    let district = districts.get(building.repositoryId);
    if (!district) {
      district = {
        id: building.repositoryId,
        repositoryId: building.repositoryId,
        blocks: [],
        capacity: 0,
      };
      districts.set(district.id, district);
    }
    let slots = occupied.get(building.repositoryId);
    if (!slots) occupied.set(building.repositoryId, (slots = new Map()));
    const small = compact.get(building.id) === true;
    let slot = small
      ? [...slots.entries()]
          .filter(([, cells]) => !cells.has(-1) && cells.size < CITY_COMPACT_CELLS)
          .sort(([a], [b]) => a - b)[0]?.[0]
      : undefined;
    if (slot === undefined) {
      slot = 0;
      while (slots.has(slot)) slot++;
    }
    const cells = slots.get(slot) ?? new Set<number>();
    let cell: number | undefined;
    if (small) {
      cell = 0;
      while (cells.has(cell)) cell++;
    }
    cells.add(cell ?? -1);
    slots.set(slot, cells);
    district.capacity = Math.max(district.capacity, slot + 1);
    layout.plots.push({
      id: building.id,
      repositoryId: district.repositoryId,
      districtId: district.id,
      slot,
      ...(cell === undefined ? {} : { cell }),
    });
  }
  layout.districts = [...districts.values()];
  reserveCityBlocks(layout.districts);
  return layout;
}
