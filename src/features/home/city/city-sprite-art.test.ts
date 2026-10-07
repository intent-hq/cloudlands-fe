import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import catalog from './assets/simcity/catalog.json';
import { CitySpriteArt, CitySpriteAtlas } from './city-sprite-art';
import type { CitySprite } from './home-city-sprites';

// The external image oracle has an opaque rear building and a nearer image
// which either paints the same screen point or leaves it fully transparent.
function overlappingSprites(frontOpaque: boolean, frontOwner?: string) {
  const sheet = catalog.sheets[0];
  const pixels = new Uint8ClampedArray(sheet.width * sheet.height * 4);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      pixels[(y * sheet.width + x) * 4 + 3] = x < 64 || frontOpaque ? 255 : 0;
    }
  }
  const atlas = new CitySpriteAtlas([{ image: new Image(), pixels }]);
  const sprite = (id: string, x: number): CitySprite => {
    const frame = { sheet: 0, x, y: 0, w: 64, h: 128 };
    return { id, name: id, lot: [1, 1], frames: [frame, frame, frame, frame] };
  };
  const art = new CitySpriteArt(
    atlas,
    [
      { sprite: sprite('rear', 0), x: 0, z: 0, owner: 'rear' },
      { sprite: sprite('front', 64), x: 0, z: 0.6, owner: frontOwner },
    ],
    new THREE.Color(),
  );
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.set(0, 10, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const point = new THREE.Vector2(0, 0.2);
  return { art, atlas, camera, point };
}

describe('native sprite pointer occlusion', () => {
  it('never selects a rear workspace through a visible filtered-out building', () => {
    const { art, atlas, camera, point } = overlappingSprites(true, 'front');
    try {
      art.appearance(new Set(['rear', 'front']), new THREE.Color());
      expect(art.pick(point, camera)).toBe('front');
      art.appearance(new Set(['rear']), new THREE.Color());
      expect(art.pick(point, camera)).toBeNull();
    } finally {
      art.dispose();
      atlas.dispose();
    }
  });

  it('lets transparent image pixels expose a selectable rear workspace', () => {
    const { art, atlas, camera, point } = overlappingSprites(false, 'front');
    try {
      art.appearance(new Set(['rear', 'front']), new THREE.Color());
      expect(art.pick(point, camera)).toBe('rear');
    } finally {
      art.dispose();
      atlas.dispose();
    }
  });

  it('does not select a workspace through opaque park art', () => {
    const { art, atlas, camera, point } = overlappingSprites(true, undefined);
    try {
      art.appearance(new Set(['rear']), new THREE.Color());
      expect(art.pick(point, camera)).toBeNull();
    } finally {
      art.dispose();
      atlas.dispose();
    }
  });
});
