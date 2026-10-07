import * as THREE from 'three';
import catalog from './assets/simcity/catalog.json' with { type: 'json' };
import { citySpriteRotation, type CitySprite, type CitySpriteFrame } from './home-city-sprites';
import { CITY_SPRITE_TILE_SIZE } from './home-city-layout';

interface SpriteSheet {
  image: HTMLImageElement;
  pixels: Uint8ClampedArray;
}
export interface CitySpritePlacement {
  sprite: CitySprite;
  x: number;
  z: number;
  owner?: string;
}
interface SpriteBatch {
  placements: CitySpritePlacement[];
  geometry: THREE.InstancedBufferGeometry;
  material: THREE.ShaderMaterial;
  rectangles: THREE.InstancedBufferAttribute;
  dimensions: THREE.InstancedBufferAttribute;
  fades: THREE.InstancedBufferAttribute;
}

const urls = import.meta.glob<string>('./assets/simcity/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
let loaded: Promise<SpriteSheet[]> | undefined;
// One native tile uses the same world scale in every zone and condition.
const PIXEL_SCALE = (CITY_SPRITE_TILE_SIZE * Math.SQRT2) / catalog.tileWidth;

/** Decode before the scene's ready marker, including alpha used by pointer picking. */
export function loadCitySpriteSheets(): Promise<SpriteSheet[]> {
  loaded ??= Promise.all(
    catalog.sheets.map(async (sheet) => {
      const image = new Image();
      image.src = urls[`./assets/simcity/${sheet.file}`];
      await image.decode();
      if (image.naturalWidth !== sheet.width || image.naturalHeight !== sheet.height)
        throw new Error(`City sprite sheet dimensions differ: ${sheet.file}`);
      const canvas = document.createElement('canvas');
      canvas.width = sheet.width;
      canvas.height = sheet.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('City sprite alpha data unavailable');
      context.drawImage(image, 0, 0);
      return { image, pixels: context.getImageData(0, 0, sheet.width, sheet.height).data };
    }),
  ).catch((error: unknown) => {
    loaded = undefined;
    throw error;
  });
  return loaded;
}

function groundAnchor(sprite: CitySprite): number {
  // PNG bottoms are the near corner of the isometric lot, not its center.
  return ((sprite.lot[0] + sprite.lot[1]) * catalog.tileWidth) / 8;
}

export function citySpriteHeight(sprite: CitySprite): number {
  const height = Math.max(...sprite.frames.map((frame) => frame.h)) - groundAnchor(sprite);
  return (height * PIXEL_SCALE) / Math.cos(Math.PI / 6);
}

/** GPU resources belong to a scene; model updates reuse its decoded atlases. */
export class CitySpriteAtlas {
  readonly textures: THREE.Texture[];

  constructor(readonly sheets: Awaited<ReturnType<typeof loadCitySpriteSheets>>) {
    this.textures = sheets.map(({ image }) => {
      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      return texture;
    });
  }

  opaque(frame: CitySpriteFrame, x: number, y: number): boolean {
    const sheet = catalog.sheets[frame.sheet];
    const pixel = ((frame.y + y) * sheet.width + frame.x + x) * 4 + 3;
    return this.sheets[frame.sheet].pixels[pixel] > 32;
  }

  dispose() {
    for (const texture of this.textures) texture.dispose();
  }
}

/** Camera-facing native frames share one draw per atlas, even for large cities. */
export class CitySpriteArt {
  readonly group = new THREE.Group();
  private readonly batches: SpriteBatch[] = [];
  private rotation = -1;
  private matches: ReadonlySet<string> = new Set();

  constructor(
    private readonly atlas: CitySpriteAtlas,
    private readonly placements: CitySpritePlacement[],
    background: THREE.Color,
  ) {
    for (const [sheetIndex, texture] of atlas.textures.entries()) {
      const items = placements.filter(
        (placement) => placement.sprite.frames[0].sheet === sheetIndex,
      );
      if (!items.length) continue;
      const plane = new THREE.PlaneGeometry(1, 1);
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.setIndex(plane.index?.clone() ?? null);
      geometry.setAttribute('position', plane.getAttribute('position').clone());
      geometry.setAttribute('uv', plane.getAttribute('uv').clone());
      plane.dispose();
      const positions = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 3), 3);
      const rectangles = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 4), 4);
      const dimensions = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 3), 3);
      const fades = new THREE.InstancedBufferAttribute(new Float32Array(items.length), 1);
      for (const [index, item] of items.entries()) positions.setXYZ(index, item.x, 0.08, item.z);
      geometry.setAttribute('cityPosition', positions);
      geometry.setAttribute('cityRectangle', rectangles);
      geometry.setAttribute('cityDimensions', dimensions);
      geometry.setAttribute('cityFade', fades);
      geometry.instanceCount = items.length;
      const material = new THREE.ShaderMaterial({
        toneMapped: false,
        uniforms: { atlas: { value: texture }, background: { value: background.clone() } },
        vertexShader: `
          attribute vec3 cityPosition;
          attribute vec4 cityRectangle;
          attribute vec3 cityDimensions;
          attribute float cityFade;
          varying vec2 atlasUv;
          varying float fade;
          void main() {
            vec4 center = modelViewMatrix * vec4(cityPosition, 1.0);
            center.xy += vec2((uv.x - 0.5) * cityDimensions.x,
                              uv.y * cityDimensions.y - cityDimensions.z);
            gl_Position = projectionMatrix * center;
            atlasUv = cityRectangle.xy + uv * cityRectangle.zw;
            fade = cityFade;
          }
        `,
        fragmentShader: `
          uniform sampler2D atlas;
          uniform vec3 background;
          varying vec2 atlasUv;
          varying float fade;
          void main() {
            vec4 pixel = texture2D(atlas, atlasUv);
            if (pixel.a < 0.12) discard;
            gl_FragColor = vec4(mix(pixel.rgb, background, fade), pixel.a);
            #include <colorspace_fragment>
          }
        `,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.batches.push({ placements: items, geometry, material, rectangles, dimensions, fades });
    }
    this.view(Math.PI / 4);
  }

  view(yaw: number) {
    const rotation = citySpriteRotation(yaw);
    if (rotation === this.rotation) return;
    this.rotation = rotation;
    for (const batch of this.batches) {
      for (const [index, item] of batch.placements.entries()) {
        const frame = item.sprite.frames[rotation];
        const sheet = catalog.sheets[frame.sheet];
        batch.rectangles.setXYZW(
          index,
          frame.x / sheet.width,
          1 - (frame.y + frame.h) / sheet.height,
          frame.w / sheet.width,
          frame.h / sheet.height,
        );
        batch.dimensions.setXYZ(
          index,
          frame.w * PIXEL_SCALE,
          frame.h * PIXEL_SCALE,
          groundAnchor(item.sprite) * PIXEL_SCALE,
        );
      }
      batch.rectangles.needsUpdate = true;
      batch.dimensions.needsUpdate = true;
    }
  }

  appearance(matches: ReadonlySet<string>, background: THREE.Color) {
    this.matches = matches;
    for (const batch of this.batches) {
      batch.material.uniforms.background.value.copy(background);
      for (const [index, item] of batch.placements.entries())
        batch.fades.setX(index, item.owner && !matches.has(item.owner) ? 0.88 : 0);
      batch.fades.needsUpdate = true;
    }
  }

  /** Transparent image margins never capture a click intended for a neighbor. */
  pick(point: THREE.Vector2, camera: THREE.OrthographicCamera): string | null {
    let nearest: string | null = null;
    let nearestDepth = Infinity;
    for (const item of this.placements) {
      const frame = item.sprite.frames[Math.max(0, this.rotation)];
      const center = new THREE.Vector3(item.x, 0.08, item.z).project(camera);
      const px =
        ((point.x - center.x) * (camera.right - camera.left)) / (2 * PIXEL_SCALE) + frame.w / 2;
      const py =
        frame.h -
        groundAnchor(item.sprite) -
        ((point.y - center.y) * (camera.top - camera.bottom)) / (2 * PIXEL_SCALE);
      if (px < 0 || py < 0 || px >= frame.w || py >= frame.h) continue;
      if (center.z >= nearestDepth || !this.atlas.opaque(frame, Math.floor(px), Math.floor(py)))
        continue;
      nearest = item.owner && this.matches.has(item.owner) ? item.owner : null;
      nearestDepth = center.z;
    }
    return nearest;
  }

  dispose() {
    for (const batch of this.batches) {
      batch.geometry.dispose();
      batch.material.dispose();
    }
    this.group.clear();
  }
}
