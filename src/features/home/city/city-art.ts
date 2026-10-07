import * as THREE from 'three';
import type { CityBuilding, CityModel } from './home-city-model';
import {
  CITY_BLOCK_SIZE,
  cityPlotPosition,
  citySeed,
  type CityBlock,
  type CityDistrict,
  type CityLayout,
} from './home-city-layout';
import { cityBuildingSprite, cityParkSprite, cityRepositoryZone } from './home-city-sprites';
import {
  CitySpriteArt,
  citySpriteHeight,
  type CitySpriteAtlas,
  type CitySpritePlacement,
} from './city-sprite-art';

export interface CityTheme {
  background: THREE.Color;
  foreground: THREE.Color;
  muted: THREE.Color;
  accent: THREE.Color;
  statuses: Record<CityBuilding['status'], THREE.Color>;
}
interface CityAnchor {
  id: string;
  x: number;
  y: number;
  z: number;
  district: CityDistrict;
}
interface StreetInstance {
  matrix: THREE.Matrix4;
  marking: boolean;
}

function streetGround(blocks: CityBlock[]): THREE.BufferGeometry {
  const occupied = new Set(blocks.map((block) => `${block.x}:${block.z}`));
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const block of blocks) {
    const offset = vertices.length / 3;
    for (const y of [0, -0.14]) {
      for (const [dx, dz] of [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
      ]) {
        vertices.push((block.x + dx) * CITY_BLOCK_SIZE, y, (block.z + dz) * CITY_BLOCK_SIZE);
      }
    }
    const face = (a: number, b: number, c: number, d: number) =>
      indices.push(offset + a, offset + b, offset + c, offset + a, offset + c, offset + d);
    face(0, 3, 2, 1);
    face(4, 5, 6, 7);
    for (const [dx, dz, a, b] of [
      [0, -1, 0, 1],
      [1, 0, 1, 2],
      [0, 1, 2, 3],
      [-1, 0, 3, 0],
    ]) {
      if (!occupied.has(`${block.x + dx}:${block.z + dz}`)) face(a, b, b + 4, a + 4);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export class CityArt {
  readonly group = new THREE.Group();
  readonly anchors = new Map<string, CityAnchor>();
  readonly districts: CityDistrict[];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly road = new THREE.MeshBasicMaterial({ toneMapped: false, depthWrite: false });
  private readonly pavement = new THREE.MeshBasicMaterial({ toneMapped: false, depthWrite: false });
  private readonly streets: StreetInstance[] = [];
  private readonly placements: CitySpritePlacement[] = [];
  private readonly sprites: CitySpriteArt;
  private readonly sidewalks: THREE.InstancedMesh;
  private readonly ring: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private matches: ReadonlySet<string> = new Set();

  constructor(
    model: CityModel,
    layout: CityLayout,
    private theme: CityTheme,
    atlas: CitySpriteAtlas,
  ) {
    const activeIds = new Set(model.buildings.map((building) => building.id));
    const plots = layout.plots.filter((plot) => activeIds.has(plot.id));
    this.districts = layout.districts.filter((district) =>
      plots.some((plot) => plot.districtId === district.id),
    );
    const ground = streetGround(this.districts.flatMap((district) => district.blocks));
    this.geometries.push(ground);
    const terrain = new THREE.Mesh(ground, this.road);
    terrain.position.y = -0.13;
    this.group.add(terrain);
    this.makeStreets();
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.geometries.push(box);
    this.sidewalks = new THREE.InstancedMesh(box, this.pavement, this.streets.length);
    for (const [index, item] of this.streets.entries())
      this.sidewalks.setMatrixAt(index, item.matrix);
    this.sidewalks.computeBoundingSphere();
    this.group.add(this.sidewalks);
    const zones = new Map(model.repositories.map((repo) => [repo.id, cityRepositoryZone(repo)]));
    for (const building of model.buildings) {
      const plot = plots.find((item) => item.id === building.id);
      const district = this.districts.find((item) => item.id === plot?.districtId);
      const zone = zones.get(building.repositoryId);
      if (!plot || !district || !zone) continue;
      const position = cityPlotPosition(plot, district);
      const sprite = cityBuildingSprite(building, zone);
      this.placements.push({ sprite, x: position.x, z: position.z, owner: building.id });
      this.anchors.set(building.id, {
        id: building.id,
        x: position.x,
        z: position.z,
        y: citySpriteHeight(sprite) + 0.15,
        district,
      });
    }
    this.sprites = new CitySpriteArt(atlas, this.placements, theme.background);
    this.group.add(this.sprites.group);
    const ringGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1.5, 0, -1.5),
      new THREE.Vector3(1.5, 0, -1.5),
      new THREE.Vector3(1.5, 0, 1.5),
      new THREE.Vector3(-1.5, 0, 1.5),
    ]);
    this.geometries.push(ringGeometry);
    this.ring = new THREE.LineLoop(
      ringGeometry,
      new THREE.LineBasicMaterial({ color: theme.accent, toneMapped: false, depthTest: false }),
    );
    this.ring.renderOrder = 3;
    this.ring.visible = false;
    this.group.add(this.ring);
    this.setTheme(theme);
  }

  private makeStreets() {
    const transform = new THREE.Object3D();
    const add = (
      x: number,
      y: number,
      z: number,
      sx: number,
      sy: number,
      sz: number,
      marking = false,
    ) => {
      transform.position.set(x, y, z);
      transform.scale.set(sx, sy, sz);
      transform.updateMatrix();
      this.streets.push({ matrix: transform.matrix.clone(), marking });
    };
    const owners = new Map(
      this.districts.flatMap((district) =>
        district.blocks.map((block) => [`${block.x}:${block.z}`, district.id] as const),
      ),
    );
    for (const district of this.districts) {
      for (const [index, block] of district.blocks.entries()) {
        const x = block.x * CITY_BLOCK_SIZE;
        const z = block.z * CITY_BLOCK_SIZE;
        const margin = (dx: number, dz: number) =>
          owners.get(`${block.x + dx}:${block.z + dz}`) === district.id ? 0.6 : 1.4;
        const left = x - CITY_BLOCK_SIZE / 2 + margin(-1, 0);
        const right = x + CITY_BLOCK_SIZE / 2 - margin(1, 0);
        const back = z - CITY_BLOCK_SIZE / 2 + margin(0, -1);
        const front = z + CITY_BLOCK_SIZE / 2 - margin(0, 1);
        add((left + right) / 2, -0.005, (back + front) / 2, right - left, 0.12, front - back);
        for (let lot = 0; lot < 4; lot++) {
          const slot = index * 4 + lot;
          if (slot < district.capacity) continue;
          const position = cityPlotPosition({ slot }, district);
          this.placements.push({
            sprite: cityParkSprite(citySeed(district.id) + slot),
            x: position.x,
            z: position.z,
          });
        }
        for (const [dx, dz] of [
          [1, 0],
          [0, 1],
        ]) {
          const neighbor = owners.get(`${block.x + dx}:${block.z + dz}`);
          if (!neighbor || neighbor === district.id) continue;
          for (const offset of [-2.4, 0, 2.4]) {
            add(
              x + (dx * CITY_BLOCK_SIZE) / 2 + dz * offset,
              -0.11,
              z + (dz * CITY_BLOCK_SIZE) / 2 + dx * offset,
              dx ? 0.055 : 1.1,
              0.025,
              dz ? 0.055 : 1.1,
              true,
            );
          }
        }
      }
    }
  }

  setTheme(theme: CityTheme) {
    this.theme = theme;
    this.road.color.copy(theme.background).lerp(theme.foreground, 0.07);
    this.ring.material.color.copy(theme.accent);
    const color = new THREE.Color();
    for (const [index, item] of this.streets.entries()) {
      color
        .copy(theme.background)
        .lerp(item.marking ? theme.muted : theme.foreground, item.marking ? 0.55 : 0.12);
      this.sidewalks.setColorAt(index, color);
    }
    if (this.sidewalks.instanceColor) this.sidewalks.instanceColor.needsUpdate = true;
    this.sprites.appearance(this.matches, theme.background);
  }

  appearance(_model: CityModel, matches: ReadonlySet<string>, selected: string | null) {
    this.matches = matches;
    this.sprites.appearance(matches, this.theme.background);
    const anchor = selected ? this.anchors.get(selected) : undefined;
    this.ring.visible = !!anchor;
    if (anchor) this.ring.position.set(anchor.x, 0.1, anchor.z);
  }

  view(yaw: number) {
    this.sprites.view(yaw);
  }

  pick(point: THREE.Vector2, camera: THREE.OrthographicCamera): string | null {
    return this.sprites.pick(point, camera);
  }

  dispose() {
    for (const geometry of this.geometries) geometry.dispose();
    this.road.dispose();
    this.pavement.dispose();
    this.ring.material.dispose();
    this.sidewalks.dispose();
    this.sprites.dispose();
    this.group.clear();
  }
}
