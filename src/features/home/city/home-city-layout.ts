export interface CityBlock {
  x: number;
  z: number;
}
export interface CityDistrict {
  id: string;
  repositoryId: string;
  blocks: CityBlock[];
  capacity: number;
}
export interface CityPlot {
  id: string;
  repositoryId: string;
  districtId: string;
  slot: number;
  /** Native 1x1 buildings share a 4x4 lot; larger buildings own the whole lot. */
  cell?: number;
}
export interface CityLayout {
  version: 3;
  districts: CityDistrict[];
  plots: CityPlot[];
}
interface CityPosition {
  x: number;
  z: number;
  angle: number;
}

export const CITY_BLOCK_SIZE = 9.6;
export const CITY_SPRITE_TILE_SIZE = 0.65;
const COMPACT_GRID = 4;
export const CITY_COMPACT_CELLS = COMPACT_GRID ** 2;
const LOTS_PER_BLOCK = 4;
const LOT_OFFSET = 1.8;
const directions = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const address = (block: CityBlock) => `${block.x}:${block.z}`;

export function emptyCityLayout(): CityLayout {
  return { version: 3, districts: [], plots: [] };
}

export function citySeed(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function blockBounds(blocks: CityBlock[]) {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const block of blocks) {
    minX = Math.min(minX, block.x);
    maxX = Math.max(maxX, block.x);
    minZ = Math.min(minZ, block.z);
    maxZ = Math.max(maxZ, block.z);
  }
  return { minX, maxX, minZ, maxZ };
}

export function cityDistrictBounds(district: CityDistrict) {
  const bounds = blockBounds(district.blocks);
  return {
    minX: (bounds.minX - 0.5) * CITY_BLOCK_SIZE,
    maxX: (bounds.maxX + 0.5) * CITY_BLOCK_SIZE,
    minZ: (bounds.minZ - 0.5) * CITY_BLOCK_SIZE,
    maxZ: (bounds.maxZ + 0.5) * CITY_BLOCK_SIZE,
  };
}

function frontier(blocks: CityBlock[], occupied: ReadonlySet<string>): CityBlock[] {
  const candidates = new Map<string, CityBlock>();
  for (const block of blocks) {
    for (const [dx, dz] of directions) {
      const next = { x: block.x + dx, z: block.z + dz };
      if (!occupied.has(address(next))) candidates.set(address(next), next);
    }
  }
  return [...candidates.values()];
}

function compactness(blocks: CityBlock[]): number {
  const bounds = blockBounds(blocks);
  const width = bounds.maxX - bounds.minX + 1;
  const depth = bounds.maxZ - bounds.minZ + 1;
  return width * depth + Math.max(width, depth) ** 2 * 0.3;
}

// Keep straight street corridors open to the city edge. A courtyard or winding
// alley can leave a neighborhood boxed in when several repositories grow.
function streetFrontier(blocks: CityBlock[], occupied: ReadonlySet<string>): Set<string> {
  const rows = new Map<number, { min: number; max: number }>();
  const columns = new Map<number, { min: number; max: number }>();
  for (const block of blocks) {
    const row = rows.get(block.z) ?? { min: block.x, max: block.x };
    row.min = Math.min(row.min, block.x);
    row.max = Math.max(row.max, block.x);
    rows.set(block.z, row);
    const column = columns.get(block.x) ?? { min: block.z, max: block.z };
    column.min = Math.min(column.min, block.z);
    column.max = Math.max(column.max, block.z);
    columns.set(block.x, column);
  }
  return new Set(
    frontier(blocks, occupied)
      .filter((block) => {
        const row = rows.get(block.z);
        const column = columns.get(block.x);
        return (
          !row ||
          block.x < row.min ||
          block.x > row.max ||
          !column ||
          block.z < column.min ||
          block.z > column.max
        );
      })
      .map(address),
  );
}

function openingCost(districts: CityDistrict[], blocks: CityBlock[], minimum = 1): number {
  const occupied = new Set(blocks.map(address));
  const outside = streetFrontier(blocks, occupied);
  let cost = 0;
  for (const district of districts) {
    const openings = frontier(district.blocks, occupied).filter((block) =>
      outside.has(address(block)),
    ).length;
    if (openings < minimum) return Infinity;
    cost += 1 / openings;
  }
  return cost;
}

// Rectangular neighborhoods share one lattice. Packing considers both orientations
// and edge contacts, so small repositories fill the city rather than orbiting it.
function placeDistrict(district: CityDistrict, placed: CityDistrict[]) {
  const count = Math.ceil(district.capacity / LOTS_PER_BLOCK);
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const all = placed.flatMap((item) => item.blocks);
  const occupied = new Set(all.map(address));
  let best: CityBlock[] = [];
  let score = Infinity;
  let fallback: CityBlock[] = [];
  let fallbackScore = Infinity;
  for (const [width, depth] of [
    [columns, rows],
    [rows, columns],
  ]) {
    const xs = new Set([0]);
    const zs = new Set([0]);
    for (const item of placed) {
      const bounds = blockBounds(item.blocks);
      for (const x of [bounds.minX - width, bounds.minX, bounds.maxX + 1, bounds.maxX - width + 1])
        xs.add(x);
      for (const z of [bounds.minZ - depth, bounds.minZ, bounds.maxZ + 1, bounds.maxZ - depth + 1])
        zs.add(z);
    }
    for (const x of xs) {
      for (const z of zs) {
        const blocks = Array.from({ length: width * depth }, (_, index) => ({
          x: x + (index % width),
          z: z + Math.floor(index / width),
        }));
        if (blocks.some((block) => occupied.has(address(block)))) continue;
        const contacts = blocks.reduce(
          (sum, block) =>
            sum +
            directions.filter(([dx, dz]) =>
              occupied.has(address({ x: block.x + dx, z: block.z + dz })),
            ).length,
          0,
        );
        if (all.length && !contacts) continue;
        const shape = compactness([...all, ...blocks]) - contacts * 0.05;
        if (shape < fallbackScore) {
          fallbackScore = shape;
          fallback = blocks;
        }
        const candidate =
          shape + 10 * openingCost([...placed, { ...district, blocks }], [...all, ...blocks], 2);
        if (candidate < score) {
          score = candidate;
          best = blocks;
        }
      }
    }
  }
  // Older saved layouts may already contain enclosed neighborhoods.
  district.blocks = best.length ? best : fallback;
}

export function reserveCityBlocks(districts: CityDistrict[]) {
  const placed = districts.filter((district) => district.blocks.length);
  const fresh = districts
    .filter((district) => !district.blocks.length)
    .sort((a, b) => b.capacity - a.capacity || a.repositoryId.localeCompare(b.repositoryId));
  for (const district of fresh) {
    placeDistrict(district, placed);
    placed.push(district);
  }
  const occupied = new Set(placed.flatMap((district) => district.blocks.map(address)));
  // Grow cramped neighborhoods first, keeping street corridors open for their
  // neighbors. Existing blocks and saved lot addresses never move.
  const pending = districts.filter(
    (district) => district.blocks.length * LOTS_PER_BLOCK < district.capacity,
  );
  while (pending.length) {
    pending.sort(
      (a, b) =>
        frontier(a.blocks, occupied).length - frontier(b.blocks, occupied).length ||
        a.repositoryId.localeCompare(b.repositoryId),
    );
    const district = pending[0];
    pending.shift();
    const choices = frontier(district.blocks, occupied);
    const all = placed.flatMap((item) => item.blocks);
    const neighbors = districts.filter((other) => other !== district);
    const costs = new Map(
      choices.map((block) => [
        address(block),
        openingCost(
          [...neighbors, { ...district, blocks: [...district.blocks, block] }],
          [...all, block],
        ),
      ]),
    );
    const available = choices.filter((block) => Number.isFinite(costs.get(address(block))));
    const candidates = available.length ? available : choices;
    // A completely enclosed neighborhood can continue on the nearest shared
    // street block; its saved lots still retain their original addresses.
    const fallback = candidates.length
      ? candidates
      : frontier(
          placed.flatMap((item) => item.blocks),
          occupied,
        );
    const bounds = blockBounds(district.blocks);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    fallback.sort((a, b) => {
      const score = (block: CityBlock) => {
        const cost = costs.get(address(block)) ?? Infinity;
        return (
          compactness([...district.blocks, block]) +
          (Number.isFinite(cost) ? 10 * cost : 0) +
          Math.hypot(block.x - centerX, block.z - centerZ) * 0.01
        );
      };
      return score(a) - score(b) || a.z - b.z || a.x - b.x;
    });
    const next = fallback[0];
    district.blocks.push(next);
    occupied.add(address(next));
    if (district.blocks.length * LOTS_PER_BLOCK < district.capacity) pending.push(district);
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 1024;
const validCapacity = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 100000;
const validCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10000;
const validCell = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < CITY_COMPACT_CELLS;

function migrateIslands(raw: Record<string, unknown>): CityLayout {
  if (!Array.isArray(raw.islands) || !Array.isArray(raw.plots)) return emptyCityLayout();
  const sources = new Map<string, { repositoryId: string; capacity: number }>();
  const repositories = new Set<string>();
  for (const entry of raw.islands) {
    const item = record(entry);
    if (
      !validId(item.id) ||
      !validId(item.repositoryId) ||
      sources.has(item.id) ||
      (raw.version === 2 && repositories.has(item.repositoryId)) ||
      !validCoordinate(item.x) ||
      !validCoordinate(item.z) ||
      !validCapacity(item.capacity) ||
      (raw.version === 1 && ![3, 6, 12].includes(item.capacity))
    )
      continue;
    sources.set(item.id, { repositoryId: item.repositoryId, capacity: item.capacity });
    repositories.add(item.repositoryId);
  }
  const districts = new Map<string, CityDistrict>();
  const ids = new Set<string>();
  const slots = new Set<string>();
  const plots: CityPlot[] = [];
  for (const entry of raw.plots) {
    const item = record(entry);
    const source = typeof item.islandId === 'string' ? sources.get(item.islandId) : undefined;
    const slot = `${item.islandId}:${item.slot}`;
    if (
      !validId(item.id) ||
      ids.has(item.id) ||
      !source ||
      item.repositoryId !== source.repositoryId ||
      typeof item.slot !== 'number' ||
      !Number.isInteger(item.slot) ||
      item.slot < 0 ||
      item.slot >= source.capacity ||
      slots.has(slot)
    )
      continue;
    let district = districts.get(source.repositoryId);
    if (!district) {
      district = {
        id: source.repositoryId,
        repositoryId: source.repositoryId,
        blocks: [],
        capacity: raw.version === 1 ? 0 : source.capacity,
      };
      districts.set(district.id, district);
    }
    plots.push({
      id: item.id,
      repositoryId: district.repositoryId,
      districtId: district.id,
      slot: raw.version === 1 ? district.capacity++ : item.slot,
    });
    ids.add(item.id);
    slots.add(slot);
  }
  const layout: CityLayout = { version: 3, districts: [...districts.values()], plots };
  reserveCityBlocks(layout.districts);
  return layout;
}

export function normalizeCityLayout(value: unknown): CityLayout {
  const raw = record(value);
  if (raw.version === 1 || raw.version === 2) return migrateIslands(raw);
  if (raw.version !== 3 || !Array.isArray(raw.districts) || !Array.isArray(raw.plots))
    return emptyCityLayout();
  const districts = new Map<string, CityDistrict>();
  const repositories = new Set<string>();
  const occupied = new Set<string>();
  for (const entry of raw.districts) {
    const item = record(entry);
    if (
      !validId(item.id) ||
      !validId(item.repositoryId) ||
      districts.has(item.id) ||
      repositories.has(item.repositoryId) ||
      !validCapacity(item.capacity) ||
      !Array.isArray(item.blocks) ||
      item.blocks.length > 25000 ||
      item.capacity > item.blocks.length * LOTS_PER_BLOCK
    )
      continue;
    const blocks: CityBlock[] = [];
    const local = new Set<string>();
    for (const entry of item.blocks) {
      const block = record(entry);
      if (
        !validCoordinate(block.x) ||
        !validCoordinate(block.z) ||
        !Number.isInteger(block.x) ||
        !Number.isInteger(block.z)
      )
        break;
      const point = { x: block.x, z: block.z };
      if (local.has(address(point)) || occupied.has(address(point))) break;
      blocks.push(point);
      local.add(address(point));
    }
    if (blocks.length !== item.blocks.length) continue;
    districts.set(item.id, {
      id: item.id,
      repositoryId: item.repositoryId,
      capacity: item.capacity,
      blocks,
    });
    repositories.add(item.repositoryId);
    for (const block of blocks) occupied.add(address(block));
  }
  const ids = new Set<string>();
  const slots = new Map<string, Set<number>>();
  const plots: CityPlot[] = [];
  for (const entry of raw.plots) {
    const item = record(entry);
    const district =
      typeof item.districtId === 'string' ? districts.get(item.districtId) : undefined;
    const slot = `${item.districtId}:${item.slot}`;
    const cell = validCell(item.cell) ? item.cell : undefined;
    const reserved = slots.get(slot);
    if (
      !validId(item.id) ||
      ids.has(item.id) ||
      !district ||
      item.repositoryId !== district.repositoryId ||
      typeof item.slot !== 'number' ||
      !Number.isInteger(item.slot) ||
      item.slot < 0 ||
      item.slot >= district.capacity ||
      (item.cell !== undefined && cell === undefined) ||
      (reserved !== undefined && (cell === undefined || reserved.has(-1) || reserved.has(cell)))
    )
      continue;
    plots.push({
      id: item.id,
      repositoryId: district.repositoryId,
      districtId: district.id,
      slot: item.slot,
      ...(cell === undefined ? {} : { cell }),
    });
    ids.add(item.id);
    slots.set(slot, (reserved ?? new Set<number>()).add(cell ?? -1));
  }
  const used = new Set(plots.map((plot) => plot.districtId));
  return {
    version: 3,
    districts: [...districts.values()].filter((district) => used.has(district.id)),
    plots,
  };
}

export function cityPlotPosition(
  plot: Pick<CityPlot, 'slot' | 'cell'>,
  district: CityDistrict,
): CityPosition {
  const block = district.blocks[Math.floor(plot.slot / LOTS_PER_BLOCK)];
  const lot = plot.slot % LOTS_PER_BLOCK;
  const dx =
    plot.cell === undefined ? 0 : ((plot.cell % COMPACT_GRID) - 1.5) * CITY_SPRITE_TILE_SIZE;
  const dz =
    plot.cell === undefined
      ? 0
      : (Math.floor(plot.cell / COMPACT_GRID) - 1.5) * CITY_SPRITE_TILE_SIZE;
  return {
    x: block.x * CITY_BLOCK_SIZE + (lot % 2 ? LOT_OFFSET : -LOT_OFFSET) + dx,
    z: block.z * CITY_BLOCK_SIZE + (lot < 2 ? -LOT_OFFSET : LOT_OFFSET) + dz,
    angle: 0,
  };
}
