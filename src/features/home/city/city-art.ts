import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { CityBuilding, CityModel } from './home-city-model';
import { cityPlotPosition, citySeed, type CityIsland, type CityLayout } from './home-city-layout';

export const CITY_DETAIL_LIMIT = 48;

// Material roles for the architectural illustration, independent of the app theme.
const cityPalette = {
  pearl: '#fff9ef',
  edge: '#e1e8e6',
  glass: '#629da8',
  glassLight: '#86b7b8',
  gold: '#cfab6c',
  light: '#ffc168',
  active: '#ff8861',
  attention: '#df8851',
  blocked: '#c76068',
  complete: '#7194ad',
  idle: '#95abae',
  leaf: '#475b2f',
  leafLight: '#84994c',
  trunk: '#8a7752',
  lawn: '#acb988',
  water: '#a6cccf',
  shadow: '#719bb5',
  dim: '#ccdae0',
} as const;

type Shape = 'box' | 'rounded' | 'cylinder' | 'leaf';
type Surface = 'ceramic' | 'glass' | 'metal' | 'light' | 'garden';
interface Instance {
  matrix: THREE.Matrix4;
  color: THREE.Color;
  owner?: string;
  beacon?: boolean;
}
interface Batch {
  mesh: THREE.InstancedMesh;
  instances: Instance[];
}
interface CityAnchor {
  id: string;
  x: number;
  y: number;
  z: number;
  island: CityIsland;
}

function platform(
  radius: number,
  inner: number,
  thickness: number,
  compact: boolean,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
  if (inner > 0) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelSegments: compact ? 1 : 2,
    steps: 1,
    bevelSize: 0.065,
    bevelThickness: 0.045,
    curveSegments: compact ? 16 : 48,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export class CityArt {
  readonly group = new THREE.Group();
  readonly anchors = new Map<string, CityAnchor>();
  readonly islands: CityIsland[];
  readonly pickBoxes = new Map<string, THREE.Box3>();
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly materials: Record<Surface, THREE.Material>;
  private readonly pending = new Map<string, Instance[]>();
  private readonly batches: Batch[] = [];
  private readonly transform = new THREE.Object3D();
  private readonly ring: THREE.Mesh;
  private readonly compact: boolean;

  constructor(
    model: CityModel,
    layout: CityLayout,
    private readonly focused: string | null = null,
  ) {
    this.compact = model.buildings.length > CITY_DETAIL_LIMIT;
    this.materials = {
      ceramic: new THREE.MeshStandardMaterial({ color: 'white', roughness: 0.32, metalness: 0.14 }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 'white',
        roughness: 0.12,
        metalness: 0.24,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        clearcoat: 1,
        clearcoatRoughness: 0.15,
      }),
      metal: new THREE.MeshStandardMaterial({ color: 'white', metalness: 0.65, roughness: 0.28 }),
      light: new THREE.MeshStandardMaterial({
        color: 'white',
        emissive: cityPalette.light,
        emissiveIntensity: 0.65,
        roughness: 0.5,
      }),
      garden: new THREE.MeshStandardMaterial({ color: 'white', roughness: 0.95 }),
    };
    this.materials.glass.onBeforeCompile = (shader) => {
      shader.vertexShader = `varying vec3 vCityPosition;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vCityPosition = position;
        #ifdef USE_INSTANCING
          vCityPosition *= vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        #endif`,
      );
      shader.fragmentShader = `varying vec3 vCityPosition;\n${shader.fragmentShader}`.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float pane = floor(vCityPosition.x * 3.0) + floor(vCityPosition.z * 3.0);
        float row = floor(vCityPosition.y * 2.0);
        float occupied = step(0.34, fract(sin(pane * 12.9898 + row * 78.233) * 43758.5453));
        float warm = occupied * pow(1.0 - fract(vCityPosition.y * 2.0), 2.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.67, 0.27), warm * 0.62);
        totalEmissiveRadiance += vec3(1.0, 0.48, 0.14) * warm * 0.42;`,
      );
    };
    this.geometries.set('box', new THREE.BoxGeometry(1, 1, 1));
    this.geometries.set('rounded', new RoundedBoxGeometry(1, 1, 1, 2, 0.14));
    this.geometries.set('cylinder', new THREE.CylinderGeometry(0.5, 0.5, 1, 32));
    this.geometries.set('leaf', new THREE.IcosahedronGeometry(0.5, 1));
    this.geometries.set('rounded-far', new THREE.BoxGeometry(1, 1, 1));
    this.geometries.set('cylinder-far', new THREE.CylinderGeometry(0.5, 0.5, 1, 12));
    this.geometries.set('leaf-far', new THREE.IcosahedronGeometry(0.5, 0));
    const activeIds = new Set(model.buildings.map((building) => building.id));
    const plots = layout.plots.filter((plot) => activeIds.has(plot.id));
    this.islands = layout.islands.filter((island) =>
      plots.some((plot) => plot.islandId === island.id),
    );
    for (const island of this.islands) this.island(island);
    this.bridges();
    for (const building of model.buildings) {
      const plot = plots.find((item) => item.id === building.id);
      const island = this.islands.find((item) => item.id === plot?.islandId);
      if (!plot || !island) continue;
      const pos = cityPlotPosition(plot, island);
      const height = building.floors * 0.5 + 0.3;
      this.anchors.set(building.id, {
        id: building.id,
        x: pos.x,
        z: pos.z,
        y: height + 0.72,
        island,
      });
      this.pickBoxes.set(
        building.id,
        new THREE.Box3(
          new THREE.Vector3(pos.x - 1.2, 0, pos.z - 1.2),
          new THREE.Vector3(pos.x + 1.2, height + 0.65, pos.z + 1.2),
        ),
      );
      this.building(building, pos.x, pos.z, pos.angle);
    }
    this.flush();
    const ringGeometry = new THREE.TorusGeometry(1.48, 0.027, 6, 64);
    ringGeometry.rotateX(Math.PI / 2);
    this.geometries.set('selection', ringGeometry);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: cityPalette.active });
    this.ring = new THREE.Mesh(ringGeometry, ringMaterial);
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  private add(
    shape: Shape | string,
    surface: Surface,
    color: string,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
    angle = 0,
    owner?: string,
    beacon = false,
  ) {
    if (this.compact && owner !== this.focused && this.geometries.has(`${shape}-far`))
      shape = `${shape}-far`;
    this.transform.position.set(x, y, z);
    this.transform.rotation.set(0, angle, 0);
    this.transform.scale.set(sx, sy, sz);
    this.transform.updateMatrix();
    const key = `${shape}:${surface}`;
    let bucket = this.pending.get(key);
    if (!bucket) {
      bucket = [];
      this.pending.set(key, bucket);
    }
    bucket.push({
      matrix: this.transform.matrix.clone(),
      color: new THREE.Color(color),
      owner,
      beacon,
    });
  }

  private island(island: CityIsland) {
    const { radius: r, x, z } = island;
    const inner = r > 4 ? r - 3.35 : 0;
    for (const [part, radius, hole, depth, y, color] of [
      ['base', r, inner, 0.46, -0.5, cityPalette.edge],
      ['deck', r + 0.035, inner, 0.11, -0.045, cityPalette.pearl],
      ['rim', r - 0.12, r - 0.2, 0.065, 0.09, cityPalette.pearl],
      ['lane', r - 0.45, r - 0.47, 0.012, 0.09, cityPalette.gold],
    ] as const) {
      const key = `island-${r}-${part}`;
      if (!this.geometries.has(key))
        this.geometries.set(key, platform(radius, hole, depth, this.compact));
      this.add(key, 'ceramic', color, x, y, z);
    }
    if (inner > 0) {
      const key = `pool-${r}`;
      if (!this.geometries.has(key))
        this.geometries.set(
          key,
          platform(inner + 0.1, Math.max(0, inner - 0.65), 0.02, this.compact),
        );
      this.add(key, 'glass', cityPalette.water, x, 0.05, z);
    }
    const count = island.capacity;
    for (let i = 0; i < count; i++) {
      const angle = ((i + 0.48) * Math.PI * 2) / count - Math.PI / 2;
      const distance = r - 1.85;
      const px = x + Math.cos(angle) * distance,
        pz = z + Math.sin(angle) * distance;
      this.add('cylinder', 'ceramic', cityPalette.pearl, px, 0.11, pz, 1.18, 0.12, 0.95);
      this.add('cylinder', 'garden', cityPalette.lawn, px, 0.18, pz, 0.94, 0.06, 0.73);
      this.tree(px, 0.2, pz, 0.9, i + citySeed(island.id));
      this.add(
        'box',
        'metal',
        cityPalette.gold,
        x + Math.cos(angle) * (r - 0.23),
        0.25,
        z + Math.sin(angle) * (r - 0.23),
        0.022,
        0.35,
        0.022,
      );
      this.add(
        'cylinder',
        'light',
        cityPalette.light,
        x + Math.cos(angle) * (r - 0.23),
        0.44,
        z + Math.sin(angle) * (r - 0.23),
        0.07,
        0.045,
        0.07,
      );
    }
    // Tapered supports disappear into the clouds beneath each floating garden.
    for (let i = 0; i < Math.min(count, 6); i++) {
      const angle = (i * Math.PI * 2) / Math.min(count, 6);
      this.add(
        'rounded',
        'ceramic',
        cityPalette.pearl,
        x + Math.cos(angle) * (r - 1.1),
        -0.9,
        z + Math.sin(angle) * (r - 1.1),
        0.9,
        1.25 + (i % 3) * 0.23,
        0.75,
        angle,
      );
    }
  }

  private bridges() {
    const connected: CityIsland[] = [];
    for (const island of this.islands) {
      let nearest: CityIsland | undefined;
      let best = Infinity;
      for (const other of connected) {
        const distance =
          Math.hypot(island.x - other.x, island.z - other.z) - island.radius - other.radius;
        if (distance < best) {
          best = distance;
          nearest = other;
        }
      }
      connected.push(island);
      if (!nearest) continue;
      const angle = Math.atan2(island.z - nearest.z, island.x - nearest.x);
      const a = new THREE.Vector3(
        nearest.x + Math.cos(angle) * (nearest.radius - 0.2),
        0,
        nearest.z + Math.sin(angle) * (nearest.radius - 0.2),
      );
      const b = new THREE.Vector3(
        island.x - Math.cos(angle) * (island.radius - 0.2),
        0,
        island.z - Math.sin(angle) * (island.radius - 0.2),
      );
      const length = a.distanceTo(b),
        middle = a.clone().add(b).multiplyScalar(0.5);
      this.add(
        'rounded',
        'ceramic',
        cityPalette.pearl,
        middle.x,
        -0.08,
        middle.z,
        length + 0.15,
        0.18,
        0.72,
        -angle,
      );
      for (const sign of [-1, 1]) {
        const dx = -Math.sin(angle) * 0.29 * sign,
          dz = Math.cos(angle) * 0.29 * sign;
        this.add(
          'box',
          'metal',
          cityPalette.gold,
          middle.x + dx,
          0.095,
          middle.z + dz,
          length,
          0.022,
          0.022,
          -angle,
        );
        this.add(
          'box',
          'ceramic',
          cityPalette.pearl,
          middle.x + dx,
          0.24,
          middle.z + dz,
          length,
          0.026,
          0.026,
          -angle,
        );
        for (let i = 0; i <= 4; i++) {
          const point = a.clone().lerp(b, i / 4);
          this.add(
            'box',
            'metal',
            cityPalette.gold,
            point.x + dx,
            0.16,
            point.z + dz,
            0.02,
            0.22,
            0.02,
          );
        }
      }
    }
  }

  private tree(x: number, y: number, z: number, size: number, seed: number, owner?: string) {
    this.add(
      'cylinder',
      'garden',
      cityPalette.trunk,
      x,
      y + size * 0.29,
      z,
      size * 0.07,
      size * 0.58,
      size * 0.07,
      0,
      owner,
    );
    for (let i = 0; i < (this.compact && owner !== this.focused ? 3 : 6); i++) {
      const angle = i * 2.4 + (seed % 13);
      const spread = i === 0 ? 0 : size * 0.19;
      const color = i % 3 ? cityPalette.leaf : cityPalette.leafLight;
      this.add(
        'leaf',
        'garden',
        color,
        x + Math.cos(angle) * spread,
        y + size * (0.57 + (i % 3) * 0.105),
        z + Math.sin(angle) * spread,
        size * 0.47,
        size * 0.42,
        size * 0.45,
        angle,
        owner,
      );
    }
  }

  private building(building: CityBuilding, x: number, z: number, angle: number) {
    const id = building.id,
      seed = citySeed(id),
      family = seed % 3;
    const h = building.floors * 0.5 + 0.3;
    const detailed = !this.compact || id === this.focused;
    const add = (
      shape: Shape,
      surface: Surface,
      color: string,
      dx: number,
      y: number,
      dz: number,
      sx: number,
      sy: number,
      sz: number,
      beacon = false,
    ) => {
      this.add(
        shape,
        surface,
        color,
        x + Math.cos(angle) * dx + Math.sin(angle) * dz,
        y,
        z - Math.sin(angle) * dx + Math.cos(angle) * dz,
        sx,
        sy,
        sz,
        angle,
        id,
        beacon,
      );
    };
    add('rounded', 'ceramic', cityPalette.pearl, 0, 0.2, 0, 2.45, 0.23, 2.04);
    add('rounded', 'metal', cityPalette.gold, 0, 0.33, 0, 2.16, 0.035, 1.8);
    const cylinder = family === 2;
    const shape = cylinder ? 'cylinder' : 'rounded';
    const width = cylinder ? 1.76 : family === 1 ? 1.6 : 1.95;
    const depth = cylinder ? 1.76 : family === 1 ? 1.7 : 1.35;
    add(
      shape,
      'light',
      cityPalette.light,
      0,
      h / 2 + 0.35,
      0,
      width * 0.76,
      h - 0.08,
      depth * 0.76,
    );
    add(
      shape,
      'glass',
      family === 1 ? cityPalette.glassLight : cityPalette.glass,
      0,
      h / 2 + 0.35,
      0,
      width,
      h,
      depth,
    );
    for (let floor = 0; floor <= building.floors; floor++) {
      const y = 0.39 + floor * 0.5;
      const balcony = family === 2 && floor % 2 === 0;
      add(
        shape,
        balcony ? 'ceramic' : 'metal',
        balcony ? cityPalette.pearl : cityPalette.gold,
        0,
        y,
        0,
        width + (balcony ? 0.28 : 0.025),
        balcony ? 0.11 : 0.028,
        depth + (balcony ? 0.28 : 0.025),
      );
      const panes = detailed ? (cylinder ? 12 : 5) : 0;
      for (let pane = 0; pane < panes; pane++) {
        const lit = (seed + floor * 7 + pane * 3) % 11 < 5;
        if (cylinder) {
          const a = (pane * Math.PI * 2) / panes;
          add(
            'box',
            'metal',
            cityPalette.gold,
            Math.cos(a) * 0.87,
            y + 0.23,
            Math.sin(a) * 0.87,
            0.021,
            0.48,
            0.021,
          );
          if (lit && floor < building.floors)
            add(
              'rounded',
              'light',
              cityPalette.light,
              Math.cos(a) * 0.78,
              y + 0.14,
              Math.sin(a) * 0.78,
              0.19,
              0.2,
              0.19,
            );
        } else {
          const dx = (pane / (panes - 1) - 0.5) * (width - 0.18);
          for (const sign of [-1, 1]) {
            add(
              'box',
              'metal',
              cityPalette.gold,
              dx,
              y + 0.23,
              sign * (depth / 2 - 0.02),
              0.026,
              0.47,
              0.027,
            );
            if (lit && floor < building.floors && pane < panes - 1)
              add(
                'box',
                'light',
                cityPalette.light,
                dx + (width - 0.18) / (panes - 1) / 2,
                y + 0.12,
                sign * (depth / 2 + 0.005),
                (width - 0.18) / (panes - 1) - 0.035,
                0.16,
                0.012,
              );
          }
        }
      }
    }
    if (!cylinder) {
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          add(
            'rounded',
            'ceramic',
            cityPalette.pearl,
            sx * (width / 2 - 0.04),
            h / 2 + 0.37,
            sz * (depth / 2 - 0.06),
            0.12,
            h + 0.05,
            0.16,
          );
      if (family === 1)
        add(
          'rounded',
          'ceramic',
          cityPalette.pearl,
          0,
          h / 2 + 0.4,
          depth / 2,
          0.23,
          h + 0.13,
          0.2,
        );
    }
    add(shape, 'ceramic', cityPalette.pearl, 0, h + 0.43, 0, width + 0.22, 0.19, depth + 0.22);
    add(shape, 'metal', cityPalette.gold, 0, h + 0.535, 0, width - 0.07, 0.018, depth - 0.07);
    add(shape, 'ceramic', cityPalette.edge, 0, h + 0.55, 0, width - 0.18, 0.045, depth - 0.18);
    add(
      'rounded',
      'garden',
      cityPalette.lawn,
      -0.14,
      h + 0.59,
      0.09,
      width * 0.6,
      0.055,
      depth * 0.63,
    );
    for (let i = 0; i < (detailed ? 3 : 1); i++) {
      const dx = (i - 1) * 0.36,
        dz = (i % 2) * 0.23;
      this.tree(
        x + Math.cos(angle) * dx + Math.sin(angle) * dz,
        h + 0.62,
        z - Math.sin(angle) * dx + Math.cos(angle) * dz,
        0.48 + (seed % 3) * 0.07,
        seed + i,
        id,
      );
    }
    add(
      'cylinder',
      'light',
      cityPalette.active,
      width * 0.4,
      h + 0.61,
      -depth * 0.37,
      0.1,
      0.055,
      0.1,
      true,
    );
  }

  private flush() {
    for (const [key, instances] of this.pending) {
      const split = key.lastIndexOf(':');
      const geometry = this.geometries.get(key.slice(0, split));
      if (!geometry) continue;
      const material = this.materials[key.slice(split + 1) as Surface];
      const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
      for (let i = 0; i < instances.length; i++) {
        mesh.setMatrixAt(i, instances[i].matrix);
        mesh.setColorAt(i, instances[i].color);
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      this.batches.push({ mesh, instances });
    }
    this.pending.clear();
  }

  appearance(model: CityModel, matches: ReadonlySet<string>, selected: string | null) {
    const buildings = new Map(model.buildings.map((building) => [building.id, building]));
    const dim = new THREE.Color(cityPalette.dim);
    for (const { mesh, instances } of this.batches) {
      for (let i = 0; i < instances.length; i++) {
        const item = instances[i];
        const color = item.color.clone();
        if (item.owner) {
          if (item.beacon) {
            const status = buildings.get(item.owner)?.status ?? 'idle';
            color.set(status === 'running' ? cityPalette.active : cityPalette[status]);
          }
          if (!matches.has(item.owner)) color.lerp(dim, 0.88);
        }
        mesh.setColorAt(i, color);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    const anchor = selected ? this.anchors.get(selected) : undefined;
    this.ring.visible = !!anchor;
    if (anchor) this.ring.position.set(anchor.x, 0.4, anchor.z);
  }

  dispose() {
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
    (this.ring.material as THREE.Material).dispose();
    for (const { mesh } of this.batches) mesh.dispose();
    this.group.clear();
  }
}
