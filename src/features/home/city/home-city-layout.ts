import type { CityModel } from './home-city-model';

export interface CityIsland {
  id: string;
  repositoryId: string;
  x: number;
  z: number;
  radius: number;
  capacity: number;
}
export interface CityPlot {
  id: string;
  repositoryId: string;
  islandId: string;
  slot: number;
}
export interface CityLayout {
  version: 1;
  islands: CityIsland[];
  plots: CityPlot[];
}
interface CityPosition {
  x: number;
  z: number;
  angle: number;
}

const GAP = 2.6;

export function emptyCityLayout(): CityLayout {
  return { version: 1, islands: [], plots: [] };
}

export function citySeed(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function normalizeCityLayout(value: unknown): CityLayout {
  const raw = record(value);
  if (raw.version !== 1 || !Array.isArray(raw.islands) || !Array.isArray(raw.plots))
    return emptyCityLayout();
  const layout = emptyCityLayout();
  const islandIds = new Set<string>();
  for (const entry of raw.islands) {
    const item = record(entry);
    if (
      typeof item.id !== 'string' ||
      typeof item.repositoryId !== 'string' ||
      item.id.length > 1024 ||
      item.repositoryId.length > 1024 ||
      islandIds.has(item.id) ||
      typeof item.x !== 'number' ||
      !Number.isFinite(item.x) ||
      Math.abs(item.x) > 10000 ||
      typeof item.z !== 'number' ||
      !Number.isFinite(item.z) ||
      Math.abs(item.z) > 10000 ||
      ![3, 6, 12].includes(Number(item.capacity))
    )
      continue;
    const capacity = Number(item.capacity);
    const radius = islandRadius(capacity);
    const x = item.x,
      z = item.z;
    if (
      layout.islands.some(
        (other) => Math.hypot(other.x - x, other.z - z) < other.radius + radius + GAP - 0.01,
      )
    )
      continue;
    layout.islands.push({ id: item.id, repositoryId: item.repositoryId, x, z, capacity, radius });
    islandIds.add(item.id);
  }
  const ids = new Set<string>();
  const slots = new Set<string>();
  for (const entry of raw.plots) {
    const item = record(entry);
    const island = layout.islands.find((candidate) => candidate.id === item.islandId);
    const address = `${item.islandId}:${item.slot}`;
    if (
      typeof item.id !== 'string' ||
      item.id.length > 1024 ||
      ids.has(item.id) ||
      !island ||
      item.repositoryId !== island.repositoryId ||
      typeof item.slot !== 'number' ||
      !Number.isInteger(item.slot) ||
      item.slot < 0 ||
      item.slot >= island.capacity ||
      slots.has(address)
    )
      continue;
    layout.plots.push({
      id: item.id,
      repositoryId: island.repositoryId,
      islandId: island.id,
      slot: item.slot,
    });
    ids.add(item.id);
    slots.add(address);
  }
  return layout;
}

function islandRadius(capacity: number): number {
  return capacity === 3 ? 3.9 : capacity === 6 ? 5.8 : 9.5;
}

function newIsland(repositoryId: string, count: number, islands: CityIsland[]): CityIsland {
  const capacity = count <= 3 ? 3 : count <= 6 ? 6 : 12;
  const radius = islandRadius(capacity);
  const siblings = islands.filter((island) => island.repositoryId === repositoryId);
  const origin = siblings[0] ?? { x: 0, z: 0 };
  const initialAngle = islands.length === 1 ? -Math.PI / 3 : -Math.PI / 7;
  const initialDistance = (islands[0]?.radius ?? 0) + radius + GAP;
  const preferred =
    islands.length < 3 && siblings.length === 0
      ? { x: Math.cos(initialAngle) * initialDistance, z: Math.sin(initialAngle) * initialDistance }
      : origin;
  let x = 0,
    z = 0;
  if (islands.length) {
    let best = Infinity;
    for (const anchor of islands) {
      for (let step = 0; step < 48; step++) {
        const angle = (step * Math.PI) / 24;
        const distance = anchor.radius + radius + GAP;
        const candidateX = anchor.x + Math.cos(angle) * distance;
        const candidateZ = anchor.z + Math.sin(angle) * distance;
        if (
          islands.some(
            (other) =>
              Math.hypot(other.x - candidateX, other.z - candidateZ) <
              other.radius + radius + GAP - 0.01,
          )
        )
          continue;
        const score =
          Math.hypot(candidateX - preferred.x, (candidateZ - preferred.z) * 1.1) +
          Math.abs(candidateZ) * 0.08;
        if (score < best) {
          best = score;
          x = candidateX;
          z = candidateZ;
        }
      }
    }
  }
  return { id: `${repositoryId}:${siblings.length}`, repositoryId, x, z, radius, capacity };
}

export function allocateCityLayout(model: CityModel, previous: CityLayout): CityLayout {
  const existing = new Map(previous.plots.map((plot) => [plot.id, plot]));
  const newcomers = model.buildings.filter(
    (building) => existing.get(building.id)?.repositoryId !== building.repositoryId,
  );
  if (newcomers.length === 0) return previous;
  const incoming = new Set(newcomers.map((building) => building.id));
  const layout: CityLayout = {
    version: 1,
    islands: previous.islands.map((island) => ({ ...island })),
    plots: previous.plots.filter((plot) => !incoming.has(plot.id)),
  };
  // A scoped model cannot distinguish deleted workspaces from hidden reservations.
  for (const building of [...newcomers].sort(
    (a, b) => a.repositoryId.localeCompare(b.repositoryId) || a.id.localeCompare(b.id),
  )) {
    let island = layout.islands.find(
      (candidate) =>
        candidate.repositoryId === building.repositoryId &&
        layout.plots.filter((plot) => plot.islandId === candidate.id).length < candidate.capacity,
    );
    if (!island) {
      const remaining = newcomers.filter(
        (item) =>
          item.repositoryId === building.repositoryId &&
          !layout.plots.some((plot) => plot.id === item.id),
      ).length;
      island = newIsland(building.repositoryId, remaining, layout.islands);
      layout.islands.push(island);
    }
    const occupied = new Set(
      layout.plots.filter((plot) => plot.islandId === island.id).map((plot) => plot.slot),
    );
    let slot = 0;
    while (occupied.has(slot)) slot++;
    layout.plots.push({
      id: building.id,
      repositoryId: building.repositoryId,
      islandId: island.id,
      slot,
    });
  }
  return layout;
}

export function cityPlotPosition(plot: CityPlot, island: CityIsland): CityPosition {
  const angle = (plot.slot * Math.PI * 2) / island.capacity - Math.PI / 2;
  const distance = island.radius - 2;
  return {
    x: island.x + Math.cos(angle) * distance,
    z: island.z + Math.sin(angle) * distance,
    angle: -angle + Math.PI / 2,
  };
}
