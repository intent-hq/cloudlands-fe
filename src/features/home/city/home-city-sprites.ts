import catalog from './assets/simcity/catalog.json' with { type: 'json' };
import { cityFloors, type CityBuilding } from './home-city-model';

export type CityZone = 'residential' | 'commercial' | 'industrial';
export type CityCondition = 'developed' | 'construction' | 'dilapidated';

export interface CitySpriteFrame {
  sheet: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CitySprite {
  id: string;
  name: string;
  zone?: CityZone;
  condition?: CityCondition;
  lot: readonly [number, number];
  /** Alternate camera views in quarter-turn order, starting at yaw PI / 4. */
  frames: readonly [CitySpriteFrame, CitySpriteFrame, CitySpriteFrame, CitySpriteFrame];
}

const zones: readonly CityZone[] = ['residential', 'commercial', 'industrial'];
const repositoryWords: Record<CityZone, readonly string[]> = {
  industrial: ['platform', 'backend', 'infra', 'api', 'build', 'tools'],
  commercial: [
    'studio',
    'app',
    'web',
    'frontend',
    'explorations',
    'research',
    'notes',
    'docs',
    'personal',
  ],
  residential: ['residential', 'housing'],
};

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  }
  // Avalanche the full word so common prefixes and sequential suffixes vary
  // both upper-bit density/zone choices and lower-bit design selection.
  result = Math.imul(result ^ (result >>> 16), 0x85ebca6b);
  result = Math.imul(result ^ (result >>> 13), 0xc2b2ae35);
  return (result ^ (result >>> 16)) >>> 0;
}

function namedZone(value: string): CityZone | undefined {
  const words = value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  return zones.find((zone) => repositoryWords[zone].some((word) => words.includes(word)));
}

/** Canonical ID takes precedence; unrecognized repositories vary by ID alone. */
export function cityRepositoryZone(repo: { id: string; name: string; zone?: CityZone }): CityZone {
  return (
    repo.zone ??
    namedZone(repo.id) ??
    namedZone(repo.name) ??
    (hash(repo.id) % 2 === 0 ? 'commercial' : 'industrial')
  );
}

/** Mix neighboring business zones without changing explicitly residential work. */
export function cityBuildingZone(id: string, preferred: CityZone): CityZone {
  if (preferred === 'residential' || (hash(`city-zone:${id}`) >>> 16) % 4 !== 0) return preferred;
  return preferred === 'commercial' ? 'industrial' : 'commercial';
}

export function cityBuildingCondition(status: CityBuilding['status']): CityCondition {
  if (status === 'running') return 'construction';
  if (status === 'blocked') return 'dilapidated';
  return 'developed';
}

const byId = (a: CitySprite, b: CitySprite) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const lotArea = (sprite: CitySprite) => sprite.lot[0] * sprite.lot[1];
function catalogSprite(sprite: {
  id: string;
  name: string;
  zone?: string;
  condition?: string;
  lot: number[];
  frames: CitySpriteFrame[];
}): CitySprite {
  const zone = zones.find((value) => value === sprite.zone);
  const condition = (['developed', 'construction', 'dilapidated'] as const).find(
    (value) => value === sprite.condition,
  );
  if (
    sprite.lot.length !== 2 ||
    sprite.frames.length !== 4 ||
    (sprite.zone !== undefined && zone === undefined) ||
    (sprite.condition !== undefined && condition === undefined)
  ) {
    throw new Error(`Invalid city sprite catalog entry: ${sprite.id}`);
  }
  return {
    ...sprite,
    zone,
    condition,
    lot: [sprite.lot[0], sprite.lot[1]],
    frames: [sprite.frames[0], sprite.frames[1], sprite.frames[2], sprite.frames[3]],
  };
}

const excludedIndustrial = new Set([
  'Grass Lot',
  'Crop Circle',
  'Barn',
  'Farm House',
  'Greenhouse',
]);
const buildings = catalog.buildings
  .map(catalogSprite)
  .filter(
    (sprite) =>
      sprite.lot.every((length) => length >= 2) &&
      !(
        sprite.zone === 'industrial' &&
        sprite.condition === 'developed' &&
        excludedIndustrial.has(sprite.name)
      ),
  )
  .sort(byId);
const parks = catalog.parks.map(catalogSprite).sort(byId);
const families = new Map<string, CitySprite[][]>();
for (const zone of zones) {
  for (const condition of ['developed', 'construction', 'dilapidated'] as const) {
    const candidates = buildings.filter(
      (sprite) => sprite.zone === zone && sprite.condition === condition,
    );
    const areas = [...new Set(candidates.map(lotArea))].sort((a, b) => a - b);
    families.set(
      `${zone}:${condition}`,
      areas.map((area) => candidates.filter((sprite) => lotArea(sprite) === area)),
    );
  }
}

/** Select native art by lot density; never scale its height to manufacture floors. */
export function cityBuildingSprite(building: CityBuilding, zone: CityZone): CitySprite {
  const family = families.get(`${zone}:${cityBuildingCondition(building.status)}`);
  if (!family?.length)
    throw new Error(
      `Missing city sprite family: ${zone}:${cityBuildingCondition(building.status)}`,
    );
  const known = building.files !== null && Number.isFinite(building.files) && building.files >= 0;
  const floors = known
    ? Number.isFinite(building.floors)
      ? building.floors
      : cityFloors(building.files)
    : 2;
  const tier = floors <= 3 ? 0 : floors <= 6 ? 1 : 2;
  const densities = family.filter((candidates) => {
    const area = lotArea(candidates[0]);
    return tier === 0
      ? area === 4
      : tier === 1
        ? area === 4 || area === 9
        : area === 9 || area === 16;
  });
  if (!densities.length) throw new Error(`Missing city sprite density: ${zone}:${tier}`);
  // Prefer the larger lot three quarters of the time, retaining smaller designs.
  // Separate salts avoid coupling zone switches, lot size, and building design.
  const density = (hash(`city-density:${building.id}`) >>> 16) % 4 === 0 ? 0 : densities.length - 1;
  const candidates = densities[density];
  return candidates[hash(`city-sprite:${building.id}`) % candidates.length];
}

/** Snap to the closest supplied view and wrap negative or multi-turn camera yaw. */
export function citySpriteRotation(yaw: number): 0 | 1 | 2 | 3 {
  if (!Number.isFinite(yaw)) return 0;
  const turn = Math.round((yaw - Math.PI / 4) / (Math.PI / 2));
  return (((turn % 4) + 4) % 4) as 0 | 1 | 2 | 3;
}

export function cityParkSprite(seed: number): CitySprite {
  if (!parks.length) throw new Error('Missing city park sprites');
  return parks[hash(String(seed)) % parks.length];
}
