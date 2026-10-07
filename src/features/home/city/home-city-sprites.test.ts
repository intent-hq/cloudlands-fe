import { describe, expect, it } from 'vitest';
import catalog from './assets/simcity/catalog.json';
import { createCityFixture } from './home-city-fixtures';
import { cityFloors, type CityBuilding } from './home-city-model';
import {
  cityBuildingCondition,
  cityBuildingSprite,
  cityParkSprite,
  cityRepositoryZone,
  citySpriteRotation,
  type CityZone,
} from './home-city-sprites';

// Failures to prevent: wrong repo association, missing status families, unstable
// identity after renaming/filtering, excessive density for unknown volume,
// rotation seams, empty parks, and incomplete/out-of-bounds atlas rectangles.
const zones: CityZone[] = ['residential', 'commercial', 'industrial'];
const building = createCityFixture('one').buildings[0];
const withFiles = (files: number | null): CityBuilding => ({
  ...building,
  files,
  floors: cityFloors(files),
  status: 'idle',
});
const area = (sprite: { lot: readonly number[] }) => sprite.lot[0] * sprite.lot[1];

describe('city sprite selection', () => {
  it.each([
    ['industrial', ['platform', 'backend', 'infra', 'api', 'build', 'tools']],
    ['commercial', ['studio', 'app', 'web', 'frontend']],
    ['residential', ['explorations', 'research', 'notes', 'docs', 'personal']],
  ] as const)('associates %s repositories by name or canonical ID', (zone, names) => {
    for (const name of names) {
      expect(cityRepositoryZone({ id: 'unclassified', name: `acme/${name}-service` })).toBe(zone);
      expect(cityRepositoryZone({ id: `repository:acme/${name}`, name: 'Renamed' })).toBe(zone);
    }
  });

  it('hashes unknown repository IDs consistently with useful distribution', () => {
    const repositories = Array.from({ length: 90 }, (_, i) => ({
      id: `repo-${i}`,
      name: 'Untitled',
    }));
    const selected = repositories.map(cityRepositoryZone);
    expect(new Set(selected)).toEqual(new Set(zones));
    expect(repositories.map((repo) => cityRepositoryZone({ ...repo, name: 'Renamed' }))).toEqual(
      selected,
    );
    for (const zone of zones)
      expect(selected.filter((value) => value === zone).length).toBeGreaterThan(10);
  });

  it.each([
    ['running', 'construction'],
    ['blocked', 'dilapidated'],
    ['attention', 'developed'],
    ['complete', 'developed'],
    ['idle', 'developed'],
  ] as const)('selects %s work from the %s family in every zone', (status, condition) => {
    expect(cityBuildingCondition(status)).toBe(condition);
    for (const zone of zones) {
      const sprite = cityBuildingSprite({ ...building, status }, zone);
      expect(sprite.zone).toBe(zone);
      expect(sprite.condition).toBe(condition);
      expect(catalog.buildings.some((candidate) => candidate.id === sprite.id)).toBe(true);
    }
  });

  it('preserves designs through renaming, filtering, and order changes', () => {
    const buildings = createCityFixture('showcase').buildings;
    const selected = new Map(
      buildings.map((item) => [item.id, cityBuildingSprite(item, 'commercial').id]),
    );
    const reordered = [...buildings]
      .reverse()
      .slice(2)
      .map((item) => ({
        ...item,
        title: 'New title',
        workspace: { ...item.workspace, title: 'New title', statusMessage: 'New message' },
      }));
    for (const item of reordered)
      expect(cityBuildingSprite(item, 'commercial').id).toBe(selected.get(item.id));
  });

  it('uses natural lot density and keeps designs stable within each volume tier', () => {
    for (const zone of zones) {
      const small = cityBuildingSprite(withFiles(0), zone);
      const medium = cityBuildingSprite(withFiles(7), zone);
      const large = cityBuildingSprite(withFiles(128), zone);
      expect(area(small)).toBeLessThan(area(medium));
      expect(area(medium)).toBeLessThan(area(large));
      expect(cityBuildingSprite(withFiles(1), zone)).toEqual(small);
      expect(cityBuildingSprite(withFiles(15), zone)).toEqual(medium);
      expect(cityBuildingSprite(withFiles(1_000_000), zone)).toEqual(large);
      expect(cityBuildingSprite(withFiles(null), zone)).toEqual(small);
      expect(cityBuildingSprite({ ...withFiles(null), floors: 8 }, zone)).toEqual(small);
    }
  });

  it('varies workspace and park designs without depending on call order', () => {
    const ids = Array.from({ length: 120 }, (_, i) => `workspace-${i}`);
    const selections = ids.map(
      (id) => cityBuildingSprite({ ...withFiles(7), id }, 'commercial').id,
    );
    expect(new Set(selections).size).toBeGreaterThan(1);
    expect(
      [...ids].reverse().map((id) => cityBuildingSprite({ ...withFiles(7), id }, 'commercial').id),
    ).toEqual([...selections].reverse());
    const parks = Array.from({ length: 20 }, (_, i) => cityParkSprite(i));
    expect(new Set(parks.map((park) => park.id)).size).toBeGreaterThan(1);
    expect(cityParkSprite(-7)).toEqual(cityParkSprite(-7));
    for (const park of parks)
      expect(catalog.parks.some((candidate) => candidate.id === park.id)).toBe(true);
  });

  it('maps canonical yaw and clockwise quarter turns with positive and negative wraparound', () => {
    for (let turn = -12; turn <= 12; turn++) {
      const expected = ((turn % 4) + 4) % 4;
      const yaw = Math.PI / 4 + (turn * Math.PI) / 2;
      expect(citySpriteRotation(yaw)).toBe(expected);
      expect(citySpriteRotation(yaw + 0.01)).toBe(expected);
      expect(citySpriteRotation(yaw - 0.01)).toBe(expected);
    }
    expect(citySpriteRotation(Number.NaN)).toBe(0);
    expect(citySpriteRotation(Infinity)).toBe(0);
  });

  it('provides complete, in-bounds four-view atlas rectangles and density families', () => {
    expect(catalog.tileWidth).toBe(32);
    expect(catalog.sheets.length).toBeGreaterThan(0);
    const sprites = [...catalog.buildings, ...catalog.parks];
    expect(new Set(sprites.map((sprite) => sprite.id)).size).toBe(sprites.length);
    for (const sprite of sprites) {
      expect(sprite.frames).toHaveLength(4);
      expect(sprite.lot).toHaveLength(2);
      for (const length of sprite.lot) expect(Number.isInteger(length) && length > 0).toBe(true);
      for (const frame of sprite.frames) {
        const sheet = catalog.sheets[frame.sheet];
        expect(sheet).toBeDefined();
        for (const value of [frame.sheet, frame.x, frame.y, frame.w, frame.h])
          expect(Number.isInteger(value)).toBe(true);
        expect(frame.x).toBeGreaterThanOrEqual(0);
        expect(frame.y).toBeGreaterThanOrEqual(0);
        expect(frame.w).toBeGreaterThan(0);
        expect(frame.h).toBeGreaterThan(0);
        expect(frame.x + frame.w).toBeLessThanOrEqual(sheet.width);
        expect(frame.y + frame.h).toBeLessThanOrEqual(sheet.height);
      }
    }
    for (const zone of zones) {
      for (const condition of ['developed', 'construction', 'dilapidated']) {
        const family = catalog.buildings.filter(
          (sprite) => sprite.zone === zone && sprite.condition === condition,
        );
        expect(new Set(family.map(area)).size).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
