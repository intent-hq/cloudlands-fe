import * as THREE from 'three';
import type { CityTheme } from './city-art';
import type { CityBuilding, CityModel } from './home-city-model';
import {
  CITY_BLOCK_SIZE,
  cityPlotPosition,
  citySeed,
  type CityBlock,
  type CityDistrict,
  type CityLayout,
} from './home-city-layout';

export const CITY_DETAIL_LIMIT = 48;

type Tone = 'structure' | 'detail' | 'landscape' | 'street' | 'accent';
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
  district: CityDistrict;
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

export class CityWireframeArt {
  readonly billboard = false;
  readonly group = new THREE.Group();
  readonly anchors = new Map<string, CityAnchor>();
  readonly districts: CityDistrict[];
  private readonly raycaster = new THREE.Raycaster();
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
  private readonly ownerScales = new Map<string, number>();
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
    this.districts = layout.districts.filter((district) =>
      plots.some((plot) => plot.districtId === district.id),
    );
    this.streets();
    for (const building of model.buildings) {
      const plot = plots.find((item) => item.id === building.id);
      const district = this.districts.find((item) => item.id === plot?.districtId);
      if (!plot || !district) continue;
      const pos = cityPlotPosition(plot, district);
      const height = building.floors * 0.5 + 0.3;
      const scale = plot.cell !== undefined ? 0.25 : 1;
      this.ownerScales.set(building.id, scale);
      this.anchors.set(building.id, {
        id: building.id,
        x: pos.x,
        z: pos.z,
        y: (height + 0.72) * scale,
        district,
      });
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
    const scale = owner ? (this.ownerScales.get(owner) ?? 1) : 1;
    const anchor = owner ? this.anchors.get(owner) : undefined;
    this.transform.position.set(
      anchor ? anchor.x + (x - anchor.x) * scale : x,
      y * scale,
      anchor ? anchor.z + (z - anchor.z) * scale : z,
    );
    this.transform.rotation.set(0, angle, 0);
    this.transform.scale.set(sx * scale, sy * scale, sz * scale);
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

  private streets() {
    if (!this.districts.length) return;
    // One continuous ground joins every neighborhood. Sidewalks leave narrow
    // local streets and wider avenues at repository boundaries.
    this.geometries.set(
      'ground',
      streetGround(this.districts.flatMap((district) => district.blocks)),
    );
    this.add('ground', 'street', 0, -0.13, 0);
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
        this.add(
          'box',
          'street',
          (left + right) / 2,
          -0.005,
          (back + front) / 2,
          right - left,
          0.12,
          front - back,
        );
        for (let lot = 0; lot < 4; lot++) {
          const slot = index * 4 + lot;
          if (slot < district.capacity) continue;
          const position = cityPlotPosition({ slot }, district);
          this.tree(position.x, 0.055, position.z, 0.95, citySeed(district.id) + slot);
        }
        for (const [dx, dz] of [
          [1, 0],
          [0, 1],
        ]) {
          const neighbor = owners.get(`${block.x + dx}:${block.z + dz}`);
          if (!neighbor || neighbor === district.id) continue;
          // Dashed center markings distinguish avenues without boxing in a repo.
          for (const offset of [-2.4, 0, 2.4]) {
            this.add(
              'box',
              'street',
              x + (dx * CITY_BLOCK_SIZE) / 2 + dz * offset,
              -0.11,
              z + (dz * CITY_BLOCK_SIZE) / 2 + dx * offset,
              dx ? 0.04 : 1.1,
              0.025,
              dz ? 0.04 : 1.1,
            );
          }
        }
      }
    }
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
    if (anchor) {
      const scale = this.ownerScales.get(anchor.id) ?? 1;
      this.ring.scale.setScalar(scale);
      this.ring.position.set(anchor.x, 0.4 * scale, anchor.z);
    }
  }

  private recolor() {
    const { background, foreground, muted, accent, statuses } = this.theme;
    const tones = {
      structure: foreground.clone().lerp(background, 0.32),
      detail: muted.clone().lerp(background, 0.15),
      landscape: muted.clone().lerp(foreground, 0.2),
      street: muted.clone().lerp(background, 0.48),
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

  view(_yaw: number) {}

  pick(point: THREE.Vector2, camera: THREE.OrthographicCamera): string | null {
    this.group.updateWorldMatrix(true, true);
    this.raycaster.setFromCamera(point, camera);
    // Only opaque instance meshes participate: shader-instanced edges cannot
    // use Three's ordinary LineSegments raycast, and filtered geometry occludes.
    const hit = this.raycaster.intersectObjects(
      this.batches.map(({ mesh }) => mesh),
      false,
    )[0];
    if (!hit || hit.instanceId === undefined) return null;
    const batch = this.batches.find(({ mesh }) => mesh === hit.object);
    const owner = batch?.instances[hit.instanceId]?.owner;
    return owner && this.matches.has(owner) ? owner : null;
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
