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
  // Legacy rings are accepted at the persistence boundary and migrated before allocation.
  version: 1 | 2;
  islands: CityIsland[];
  plots: CityPlot[];
}
interface CityPosition {
  x: number;
  z: number;
  angle: number;
}

const ISLAND_GAP = 3.2;
const PLOT_SPACING = 3.4;
const SHORE_MARGIN = 2.6;
const footprints = new Map<number, { x: number; z: number; radius: number }>();

export function emptyCityLayout(): CityLayout {
  return { version: 2, islands: [], plots: [] };
}

export function citySeed(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

// A hexagonal spiral fills the interior while keeping every reserved address stable.
function slotPosition(slot: number): { x: number; z: number } {
  if (slot === 0) return { x: 0, z: 0 };
  const ring = Math.ceil((Math.sqrt(12 * slot + 9) - 3) / 6);
  const offset = slot - (1 + 3 * (ring - 1) * ring);
  const side = Math.floor(offset / ring);
  const step = offset % ring;
  const [q, r] = [
    [ring - step, step],
    [-step, ring],
    [-ring, ring - step],
    [-ring + step, -step],
    [step, -ring],
    [ring, -ring + step],
  ][side];
  return { x: (q + r / 2) * PLOT_SPACING, z: r * PLOT_SPACING * (Math.sqrt(3) / 2) };
}

function islandFootprint(capacity: number): { x: number; z: number; radius: number } {
  const cached = footprints.get(capacity);
  if (cached) return cached;
  const positions = Array.from({ length: capacity }, (_, slot) => slotPosition(slot));
  const xs = positions.map((point) => point.x);
  const zs = positions.map((point) => point.z);
  const x = (Math.min(...xs) + Math.max(...xs)) / 2;
  const z = (Math.min(...zs) + Math.max(...zs)) / 2;
  const radius = Math.max(...positions.map((point) => Math.hypot(point.x - x, point.z - z)));
  const footprint = { x, z, radius: radius + SHORE_MARGIN };
  const oldest = footprints.keys().next();
  if (footprints.size >= 32 && !oldest.done) footprints.delete(oldest.value);
  footprints.set(capacity, footprint);
  return footprint;
}

function separated(a: CityIsland, b: CityIsland): boolean {
  return Math.hypot(a.x - b.x, a.z - b.z) >= a.radius + b.radius + ISLAND_GAP - 0.001;
}

// Pack largest first, keeping a fixed shore-to-shore gap and minimizing the group bounds.
function packIslands(islands: CityIsland[]): CityIsland[] {
  const placed: CityIsland[] = [];
  for (const source of [...islands].sort(
    (a, b) => b.radius - a.radius || a.repositoryId.localeCompare(b.repositoryId),
  )) {
    const island = { ...source, x: 0, z: 0 };
    const minX = Math.min(...placed.map((item) => item.x - item.radius));
    const maxX = Math.max(...placed.map((item) => item.x + item.radius));
    const minZ = Math.min(...placed.map((item) => item.z - item.radius));
    const maxZ = Math.max(...placed.map((item) => item.z + item.radius));
    let best = Infinity;
    for (const anchor of placed) {
      for (let step = 0; step < 72; step++) {
        const angle = (step * Math.PI) / 36;
        const distance = anchor.radius + island.radius + ISLAND_GAP;
        const candidate = {
          ...island,
          x: anchor.x + Math.cos(angle) * distance,
          z: anchor.z + Math.sin(angle) * distance,
        };
        if (!placed.every((other) => separated(candidate, other))) continue;
        const width =
          Math.max(maxX, candidate.x + island.radius) - Math.min(minX, candidate.x - island.radius);
        const depth =
          Math.max(maxZ, candidate.z + island.radius) - Math.min(minZ, candidate.z - island.radius);
        const score = Math.max(width, depth) + (width + depth) * 0.1;
        if (score < best) {
          best = score;
          island.x = candidate.x;
          island.z = candidate.z;
        }
      }
    }
    placed.push(island);
  }
  return placed;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function normalizeCityLayout(value: unknown): CityLayout {
  const raw = record(value);
  if (
    (raw.version !== 1 && raw.version !== 2) ||
    !Array.isArray(raw.islands) ||
    !Array.isArray(raw.plots)
  )
    return emptyCityLayout();
  const sources = new Map<string, CityIsland>();
  const repositories = new Set<string>();
  for (const entry of raw.islands) {
    const item = record(entry);
    if (
      typeof item.id !== 'string' ||
      typeof item.repositoryId !== 'string' ||
      item.id.length > 1024 ||
      item.repositoryId.length > 1024 ||
      sources.has(item.id) ||
      (raw.version === 2 && repositories.has(item.repositoryId)) ||
      typeof item.x !== 'number' ||
      !Number.isFinite(item.x) ||
      Math.abs(item.x) > 10000 ||
      typeof item.z !== 'number' ||
      !Number.isFinite(item.z) ||
      Math.abs(item.z) > 10000 ||
      typeof item.capacity !== 'number' ||
      !Number.isInteger(item.capacity) ||
      item.capacity < 1 ||
      item.capacity > 100000 ||
      (raw.version === 1 && ![3, 6, 12].includes(item.capacity))
    )
      continue;
    sources.set(item.id, {
      id: item.id,
      repositoryId: item.repositoryId,
      x: item.x,
      z: item.z,
      capacity: item.capacity,
      radius: 0,
    });
    repositories.add(item.repositoryId);
  }
  const islands = new Map<string, CityIsland>();
  const ids = new Set<string>();
  const slots = new Set<string>();
  const plots: CityPlot[] = [];
  for (const entry of raw.plots) {
    const item = record(entry);
    const source = typeof item.islandId === 'string' ? sources.get(item.islandId) : undefined;
    const address = `${item.islandId}:${item.slot}`;
    if (
      typeof item.id !== 'string' ||
      item.id.length > 1024 ||
      ids.has(item.id) ||
      !source ||
      item.repositoryId !== source.repositoryId ||
      typeof item.slot !== 'number' ||
      !Number.isInteger(item.slot) ||
      item.slot < 0 ||
      item.slot >= source.capacity ||
      slots.has(address)
    )
      continue;
    let island = islands.get(source.repositoryId);
    if (!island) {
      island = {
        ...source,
        id: source.repositoryId,
        capacity: raw.version === 1 ? 0 : source.capacity,
      };
      islands.set(source.repositoryId, island);
    }
    plots.push({
      id: item.id,
      repositoryId: island.repositoryId,
      islandId: island.id,
      slot: raw.version === 1 ? island.capacity++ : item.slot,
    });
    ids.add(item.id);
    slots.add(address);
  }
  const normalized = [...islands.values()].map((island) => ({
    ...island,
    radius: islandFootprint(island.capacity).radius,
  }));
  const needsPacking =
    raw.version === 1 ||
    normalized.some((island, index) =>
      normalized.slice(index + 1).some((other) => !separated(island, other)),
    );
  return { version: 2, islands: needsPacking ? packIslands(normalized) : normalized, plots };
}

export function allocateCityLayout(model: CityModel, previous: CityLayout): CityLayout {
  const base = previous.version === 1 ? normalizeCityLayout(previous) : previous;
  const existing = new Map(base.plots.map((plot) => [plot.id, plot]));
  const newcomers = model.buildings.filter(
    (building) => existing.get(building.id)?.repositoryId !== building.repositoryId,
  );
  if (newcomers.length === 0) return base;
  const incoming = new Set(newcomers.map((building) => building.id));
  const layout: CityLayout = {
    version: 2,
    islands: base.islands.map((island) => ({ ...island })),
    plots: base.plots.filter((plot) => !incoming.has(plot.id)),
  };
  const islands = new Map(layout.islands.map((island) => [island.repositoryId, island]));
  const occupied = new Map<string, Set<number>>();
  for (const plot of layout.plots) {
    let slots = occupied.get(plot.repositoryId);
    if (!slots) occupied.set(plot.repositoryId, (slots = new Set()));
    slots.add(plot.slot);
  }
  const cursors = new Map<string, number>();
  // A scoped model cannot distinguish deleted workspaces from hidden reservations.
  for (const building of [...newcomers].sort(
    (a, b) => a.repositoryId.localeCompare(b.repositoryId) || a.id.localeCompare(b.id),
  )) {
    let island = islands.get(building.repositoryId);
    if (!island) {
      island = {
        id: building.repositoryId,
        repositoryId: building.repositoryId,
        x: 0,
        z: 0,
        radius: 0,
        capacity: 0,
      };
      islands.set(building.repositoryId, island);
    }
    let slots = occupied.get(building.repositoryId);
    if (!slots) occupied.set(building.repositoryId, (slots = new Set()));
    let slot = cursors.get(building.repositoryId) ?? 0;
    while (slots.has(slot)) slot++;
    slots.add(slot);
    cursors.set(building.repositoryId, slot + 1);
    island.capacity = Math.max(island.capacity, slot + 1);
    layout.plots.push({
      id: building.id,
      repositoryId: building.repositoryId,
      islandId: island.id,
      slot,
    });
  }
  layout.islands = packIslands(
    [...islands.values()]
      .filter((island) => occupied.get(island.repositoryId)?.size)
      .map((island) => ({ ...island, radius: islandFootprint(island.capacity).radius })),
  );
  return layout;
}

export function cityPlotPosition(plot: CityPlot, island: CityIsland): CityPosition {
  const point = slotPosition(plot.slot);
  const center = islandFootprint(island.capacity);
  return { x: island.x + point.x - center.x, z: island.z + point.z - center.z, angle: 0 };
}
