import * as THREE from 'three';
import type { CityBuilding, CityModel } from './home-city-model';
import { cityPlotPosition, citySeed, type CityIsland, type CityLayout } from './home-city-layout';

export const CITY_DETAIL_LIMIT = 48;

export interface CityTheme {
  background: THREE.Color;
  foreground: THREE.Color;
  muted: THREE.Color;
  accent: THREE.Color;
  statuses: Record<CityBuilding['status'], THREE.Color>;
}

type Tone = 'structure' | 'detail' | 'landscape' | 'accent';
type Shape = 'box' | 'rounded' | 'cylinder' | 'leaf';
interface Instance {
  matrix: THREE.Matrix4;
  tone: Tone;
  owner?: string;
  beacon?: boolean;
}
interface Batch {
  mesh: THREE.InstancedMesh;
  instances: Instance[];
  colors: THREE.InstancedBufferAttribute;
}
interface CityAnchor {
  id: string;
  x: number;
  y: number;
  z: number;
  island: CityIsland;
}

function platform(island: CityIsland, compact: boolean): THREE.ExtrudeGeometry {
  const phase = ((citySeed(island.repositoryId) % 360) * Math.PI) / 180;
  const variation = Math.min(0.4, island.radius * 0.08);
  const coast = Array.from({ length: 12 }, (_, index) => {
    const angle = (index * Math.PI * 2) / 12;
    const radius =
      island.radius -
      variation -
      0.15 +
      Math.sin(angle * 3 + phase) * variation * 0.55 +
      Math.sin(angle * 2 - phase) * variation * 0.45;
    return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
  });
  const curve = new THREE.CatmullRomCurve3(coast, true);
  const shape = new THREE.Shape(
    curve.getPoints(compact ? 64 : 96).map((point) => new THREE.Vector2(point.x, point.y)),
  );
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false, steps: 1 });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export class CityArt {
  readonly group = new THREE.Group();
  readonly anchors = new Map<string, CityAnchor>();
  readonly islands: CityIsland[];
  readonly pickBoxes = new Map<string, THREE.Box3>();
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  // Background-colored faces hide rear edges without introducing shaded surfaces.
  private readonly faces = new THREE.MeshBasicMaterial({
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  private readonly edges = new THREE.ShaderMaterial({
    toneMapped: false,
    vertexShader: `
      attribute mat4 cityMatrix;
      attribute vec3 cityColor;
      varying vec3 ink;
      void main() {
        ink = cityColor;
        gl_Position = projectionMatrix * modelViewMatrix * cityMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 ink;
      void main() {
        gl_FragColor = vec4(ink, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  private statuses = new Map<string, CityBuilding['status']>();
  private matches: ReadonlySet<string> = new Set();
  private selected: string | null = null;
  private readonly pending = new Map<string, Instance[]>();
  private readonly batches: Batch[] = [];
  private readonly transform = new THREE.Object3D();
  private readonly ring: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly compact: boolean;

  constructor(
    model: CityModel,
    layout: CityLayout,
    private theme: CityTheme,
    private readonly focused: string | null = null,
  ) {
    this.compact = model.buildings.length > CITY_DETAIL_LIMIT;
    this.faces.color.copy(theme.background);
    this.geometries.set('box', new THREE.BoxGeometry(1, 1, 1));
    this.geometries.set('rounded', new THREE.BoxGeometry(1, 1, 1));
    this.geometries.set('cylinder', new THREE.CylinderGeometry(0.5, 0.5, 1, 16));
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
    const ringGeometry = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 64 }, (_, index) => {
        const angle = (index * Math.PI * 2) / 64;
        return new THREE.Vector3(Math.cos(angle) * 1.48, 0, Math.sin(angle) * 1.48);
      }),
    );
    this.geometries.set('selection', ringGeometry);
    this.ring = new THREE.LineLoop(
      ringGeometry,
      new THREE.LineBasicMaterial({ color: theme.accent, toneMapped: false }),
    );
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  private add(
    shape: Shape | string,
    tone: Tone,
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
    const key = shape;
    let bucket = this.pending.get(key);
    if (!bucket) {
      bucket = [];
      this.pending.set(key, bucket);
    }
    bucket.push({
      matrix: this.transform.matrix.clone(),
      tone,
      owner,
      beacon,
    });
  }

  private island(island: CityIsland) {
    const key = `island-${island.id}`;
    this.geometries.set(key, platform(island, this.compact));
    this.add(key, 'structure', island.x, -0.16, island.z);
  }

  private tree(x: number, y: number, z: number, size: number, seed: number, owner?: string) {
    this.add(
      'cylinder',
      'landscape',
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
      this.add(
        'leaf',
        'landscape',
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
      tone: Tone,
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
        tone,
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
    add('rounded', 'structure', 0, 0.2, 0, 2.45, 0.23, 2.04);
    add('rounded', 'detail', 0, 0.33, 0, 2.16, 0.035, 1.8);
    const cylinder = family === 2;
    const shape = cylinder ? 'cylinder' : 'rounded';
    const width = cylinder ? 1.76 : family === 1 ? 1.6 : 1.95;
    const depth = cylinder ? 1.76 : family === 1 ? 1.7 : 1.35;
    add(shape, 'detail', 0, h / 2 + 0.35, 0, width * 0.76, h - 0.08, depth * 0.76);
    add(shape, 'detail', 0, h / 2 + 0.35, 0, width, h, depth);
    for (let floor = 0; floor <= building.floors; floor++) {
      const y = 0.39 + floor * 0.5;
      const balcony = family === 2 && floor % 2 === 0;
      add(
        shape,
        balcony ? 'structure' : 'detail',
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
            'detail',
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
              'detail',
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
            add('box', 'detail', dx, y + 0.23, sign * (depth / 2 - 0.02), 0.026, 0.47, 0.027);
            if (lit && floor < building.floors && pane < panes - 1)
              add(
                'box',
                'detail',
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
            'structure',
            sx * (width / 2 - 0.04),
            h / 2 + 0.37,
            sz * (depth / 2 - 0.06),
            0.12,
            h + 0.05,
            0.16,
          );
      if (family === 1) add('rounded', 'structure', 0, h / 2 + 0.4, depth / 2, 0.23, h + 0.13, 0.2);
    }
    add(shape, 'structure', 0, h + 0.43, 0, width + 0.22, 0.19, depth + 0.22);
    add(shape, 'detail', 0, h + 0.535, 0, width - 0.07, 0.018, depth - 0.07);
    add(shape, 'structure', 0, h + 0.55, 0, width - 0.18, 0.045, depth - 0.18);
    add('rounded', 'landscape', -0.14, h + 0.59, 0.09, width * 0.6, 0.055, depth * 0.63);
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
    add('cylinder', 'accent', width * 0.4, h + 0.61, -depth * 0.37, 0.1, 0.055, 0.1, true);
  }

  private flush() {
    for (const [key, instances] of this.pending) {
      const geometry = this.geometries.get(key);
      if (!geometry) continue;
      const mesh = new THREE.InstancedMesh(geometry, this.faces, instances.length);
      for (let i = 0; i < instances.length; i++) mesh.setMatrixAt(i, instances[i].matrix);
      mesh.computeBoundingSphere();
      this.group.add(mesh);

      // Share instance transforms with the picking/occlusion mesh. EdgesGeometry
      // removes coplanar triangle diagonals, keeping the architecture legible.
      const outline = new THREE.EdgesGeometry(geometry, 10);
      const lines = new THREE.InstancedBufferGeometry();
      lines.setAttribute('position', outline.getAttribute('position').clone());
      outline.dispose();
      lines.setAttribute('cityMatrix', mesh.instanceMatrix);
      const colors = new THREE.InstancedBufferAttribute(new Float32Array(instances.length * 3), 3);
      lines.setAttribute('cityColor', colors);
      lines.instanceCount = instances.length;
      this.geometries.set(`${key}-edges`, lines);
      const edges = new THREE.LineSegments(lines, this.edges);
      edges.renderOrder = 1;
      edges.frustumCulled = false;
      this.group.add(edges);
      this.batches.push({ mesh, instances, colors });
    }
    this.pending.clear();
  }

  setTheme(theme: CityTheme) {
    this.theme = theme;
    this.faces.color.copy(theme.background);
    this.ring.material.color.copy(theme.accent);
    this.recolor();
  }

  appearance(model: CityModel, matches: ReadonlySet<string>, selected: string | null) {
    this.statuses = new Map(model.buildings.map((building) => [building.id, building.status]));
    this.matches = matches;
    this.selected = selected;
    this.recolor();
    const anchor = selected ? this.anchors.get(selected) : undefined;
    this.ring.visible = !!anchor;
    if (anchor) this.ring.position.set(anchor.x, 0.4, anchor.z);
  }

  private recolor() {
    const { background, foreground, muted, accent, statuses } = this.theme;
    const tones = {
      structure: foreground.clone().lerp(background, 0.32),
      detail: muted.clone().lerp(background, 0.15),
      landscape: muted.clone().lerp(foreground, 0.2),
      accent,
    };
    const color = new THREE.Color();
    for (const { instances, colors } of this.batches) {
      for (let i = 0; i < instances.length; i++) {
        const item = instances[i];
        color.copy(tones[item.tone]);
        if (item.owner) {
          if (item.beacon) color.copy(statuses[this.statuses.get(item.owner) ?? 'idle']);
          else if (item.owner === this.selected) color.lerp(accent, 0.65);
          if (!this.matches.has(item.owner)) color.lerp(background, 0.86);
        }
        colors.setXYZ(i, color.r, color.g, color.b);
      }
      colors.needsUpdate = true;
    }
  }

  dispose() {
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.faces.dispose();
    this.edges.dispose();
    this.ring.material.dispose();
    for (const { mesh } of this.batches) mesh.dispose();
    this.group.clear();
  }
}
